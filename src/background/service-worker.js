/**
 * MV3 service worker: the only place that talks to Rate My Professors.
 *
 * Content scripts never make cross-origin requests themselves. They send a
 * parsed instructor name here, and this worker owns school resolution, the
 * search + match pipeline, caching and request pacing. That keeps one shared
 * cache across every open Schedule Builder tab and one choke point for
 * outbound traffic.
 */
/* global importScripts */
importScripts(
  '/src/lib/namespace.js',
  '/src/lib/name-utils.js',
  '/src/lib/matching.js',
  '/src/lib/schools.js',
  '/src/lib/cache.js',
  '/src/lib/rmp-client.js'
);

(function (root) {
  'use strict';

  const RMPX = root.RMPX;
  const { MSG, TTL, DEFAULT_SETTINGS } = RMPX;
  const cache = RMPX.cache;
  const client = RMPX.rmpClient;
  const schools = RMPX.schools;
  const matching = RMPX.matching;
  const nameUtils = RMPX.nameUtils;

  /* ----------------------------------------------------------------------- *
   * Settings
   * ----------------------------------------------------------------------- */

  function syncArea() {
    if (chrome.storage && chrome.storage.sync) return chrome.storage.sync;
    return chrome.storage.local;
  }

  function getSettings() {
    return new Promise(function (resolve) {
      syncArea().get(DEFAULT_SETTINGS, function (stored) {
        void chrome.runtime.lastError;
        resolve(Object.assign({}, DEFAULT_SETTINGS, stored || {}));
      });
    });
  }

  function setSettings(patch) {
    return new Promise(function (resolve) {
      const clean = {};
      Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
        if (patch && Object.prototype.hasOwnProperty.call(patch, key)) clean[key] = patch[key];
      });
      syncArea().set(clean, function () {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  /* ----------------------------------------------------------------------- *
   * School resolution
   * ----------------------------------------------------------------------- */

  /**
   * Turn a campus key from schools.js into RMP's opaque school id, caching the
   * answer for a long time -- these effectively never change.
   */
  async function resolveSchool(schoolKey) {
    const school = schools.getSchool(schoolKey);
    if (!school) return null;

    return cache.getOrFetch('school:' + schoolKey, TTL.SCHOOL_MS, async function () {
      const results = await client.searchSchools(school.searchText);
      if (!results.length) return null;

      const wanted = nameUtils.normalizeToken(school.name);
      const wantedSearch = nameUtils.normalizeToken(school.searchText);

      let best = null;
      let bestScore = -1;
      results.forEach(function (candidate) {
        const name = nameUtils.normalizeToken(candidate.name);
        let score = 0;
        if (name === wanted || name === wantedSearch) score += 60;
        else if (name.includes(wantedSearch) || wantedSearch.includes(name)) score += 35;
        else if (name.includes(wanted) || wanted.includes(name)) score += 30;
        // Every CUNY campus is in New York; this kills same-named schools
        // elsewhere (there is more than one "York College").
        if (String(candidate.state || '').toUpperCase() === 'NY') score += 25;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      });

      if (!best || bestScore < 30) return null;
      return { id: best.id, legacyId: best.legacyId, name: best.name };
    });
  }

  /* ----------------------------------------------------------------------- *
   * Lookup pipeline
   * ----------------------------------------------------------------------- */

  function lookupCacheKey(schoolKey, parsed) {
    return 'lookup:' + (schoolKey || 'any') + ':' + parsed.key;
  }

  /**
   * Find the RMP profile for one parsed instructor name.
   * Always resolves; failures come back as { status: 'error' } so a flaky
   * network never leaves a badge spinning forever.
   */
  async function lookupProfessor(payload) {
    const parsed = payload && payload.name;
    if (!parsed || !parsed.last || !parsed.key) {
      return { status: 'invalid' };
    }

    const schoolKey = payload.schoolKey || null;
    const cacheKey = lookupCacheKey(schoolKey, parsed);

    try {
      return await cache.getOrFetch(cacheKey, TTL.HIT_MS, async function () {
        const school = schoolKey ? await resolveSchool(schoolKey) : null;

        let candidates = await client.searchTeachers(parsed.query, school ? school.id : null, 20);

        // A "Last, First" roster entry sometimes fails a full-name search but
        // succeeds on the surname alone -- retry once before giving up.
        if (candidates.length === 0 && !parsed.initialOnly) {
          candidates = await client.searchTeachers(parsed.last, school ? school.id : null, 20);
        }

        const result = matching.pickBestMatch(parsed, candidates, {
          subjectHint: payload.subjectHint || null,
        });

        if (!result.match) {
          return {
            status: 'nomatch',
            searchUrl: RMPX.searchUrl(parsed.display, school ? school.legacyId : null),
            schoolName: school ? school.name : null,
          };
        }

        return {
          status: 'match',
          professor: result.match,
          confidence: result.confidence,
          ambiguous: result.ambiguous,
          url: result.match.legacyId ? RMPX.professorUrl(result.match.legacyId) : null,
          searchUrl: RMPX.searchUrl(parsed.display, school ? school.legacyId : null),
          schoolName: school ? school.name : null,
        };
      });
    } catch (err) {
      return { status: 'error', message: String((err && err.message) || err) };
    }
  }

  /** Full profile for the hover card, fetched on demand and cached separately. */
  async function lookupDetail(payload) {
    const nodeId = payload && payload.nodeId;
    if (!nodeId) return { status: 'invalid' };

    try {
      const detail = await cache.getOrFetch('detail:' + nodeId, TTL.DETAIL_MS, function () {
        return client.getTeacherDetail(nodeId);
      });
      if (!detail) return { status: 'nomatch' };
      return { status: 'ok', professor: detail };
    } catch (err) {
      return { status: 'error', message: String((err && err.message) || err) };
    }
  }

  /* ----------------------------------------------------------------------- *
   * Message plumbing
   * ----------------------------------------------------------------------- */

  const HANDLERS = {
    [MSG.LOOKUP]: lookupProfessor,
    [MSG.DETAIL]: lookupDetail,
    [MSG.GET_SETTINGS]: async function () {
      return { settings: await getSettings() };
    },
    [MSG.SET_SETTINGS]: async function (payload) {
      await setSettings(payload && payload.settings);
      return { settings: await getSettings() };
    },
    [MSG.CACHE_STATS]: async function () {
      return { stats: await cache.stats() };
    },
    [MSG.CLEAR_CACHE]: async function () {
      const removed = await cache.clear();
      return { removed: removed };
    },
  };

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    const handler = message && HANDLERS[message.type];
    if (!handler) return false;

    Promise.resolve(handler(message.payload || {}))
      .then(function (result) {
        sendResponse(Object.assign({ ok: true }, result));
      })
      .catch(function (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      });

    // Keep the message channel open for the async response above.
    return true;
  });

  chrome.runtime.onInstalled.addListener(function () {
    getSettings().then(setSettings);
    cache.prune();
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(function () {
      cache.prune();
    });
  }
})(typeof self !== 'undefined' ? self : globalThis);
