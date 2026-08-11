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
   * Opting extra sites in
   *
   * The manifest covers *.cuny.edu and *.collegescheduler.com, which is where
   * Schedule Builder is expected to live. If a campus serves it from somewhere
   * else, the user can grant this extension that single origin from the popup
   * and we register the same content scripts there at runtime -- no reinstall,
   * and no need to ship a broad always-on permission nobody asked for.
   * ----------------------------------------------------------------------- */

  /** Script ids are derived from the origin so registration is idempotent. */
  function scriptIdFor(origin) {
    return 'rmpx-site-' + String(origin).replace(/[^a-zA-Z0-9]/g, '-');
  }

  function originPattern(origin) {
    return String(origin).replace(/\/+$/, '') + '/*';
  }

  /** Origins already covered by the manifest need no dynamic registration. */
  function isStaticallyCovered(origin) {
    return /^https:\/\/([a-z0-9-]+\.)*(cuny\.edu|collegescheduler\.com)$/i.test(
      String(origin).replace(/\/+$/, '')
    );
  }

  async function registerSite(origin) {
    const script = {
      id: scriptIdFor(origin),
      matches: [originPattern(origin)],
      js: RMPX.CONTENT_JS,
      css: RMPX.CONTENT_CSS,
      runAt: 'document_idle',
      allFrames: true,
      persistAcrossSessions: true,
    };

    try {
      await chrome.scripting.registerContentScripts([script]);
      return true;
    } catch (err) {
      // Already registered in a previous session -- update it in place.
      try {
        await chrome.scripting.updateContentScripts([script]);
        return true;
      } catch (innerErr) {
        return false;
      }
    }
  }

  async function unregisterSite(origin) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [scriptIdFor(origin)] });
    } catch (err) {
      // Nothing registered for this origin; nothing to undo.
    }
  }

  function grantedOrigins() {
    return new Promise(function (resolve) {
      chrome.permissions.getAll(function (permissions) {
        void chrome.runtime.lastError;
        resolve((permissions && permissions.origins) || []);
      });
    });
  }

  async function siteStatus(payload) {
    const origin = payload && payload.origin;
    if (!origin) return { supported: false };

    if (isStaticallyCovered(origin)) {
      return { supported: true, origin: origin, enabled: true, builtIn: true };
    }

    const enabled = await new Promise(function (resolve) {
      chrome.permissions.contains({ origins: [originPattern(origin)] }, function (result) {
        void chrome.runtime.lastError;
        resolve(Boolean(result));
      });
    });

    return { supported: true, origin: origin, enabled: enabled, builtIn: false };
  }

  /**
   * The permission prompt itself has to happen in the popup, where there is a
   * user gesture. By the time this runs the grant already exists, so all that
   * remains is wiring up the content scripts.
   */
  async function enableSite(payload) {
    const origin = payload && payload.origin;
    if (!origin || isStaticallyCovered(origin)) return { enabled: true };
    return { enabled: await registerSite(origin) };
  }

  async function disableSite(payload) {
    const origin = payload && payload.origin;
    if (!origin || isStaticallyCovered(origin)) return { enabled: true };
    await unregisterSite(origin);
    await new Promise(function (resolve) {
      chrome.permissions.remove({ origins: [originPattern(origin)] }, function () {
        void chrome.runtime.lastError;
        resolve();
      });
    });
    return { enabled: false };
  }

  /** Re-attach content scripts for every origin the user already granted. */
  async function syncRegistrations() {
    const origins = await grantedOrigins();
    for (let i = 0; i < origins.length; i += 1) {
      const origin = String(origins[i]).replace(/\/\*$/, '');
      if (!/^https?:\/\//i.test(origin)) continue;
      if (isStaticallyCovered(origin)) continue;
      await registerSite(origin);
    }
  }

  if (chrome.permissions && chrome.permissions.onRemoved) {
    chrome.permissions.onRemoved.addListener(function (permissions) {
      ((permissions && permissions.origins) || []).forEach(function (pattern) {
        unregisterSite(String(pattern).replace(/\/\*$/, ''));
      });
    });
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
    [MSG.SITE_STATUS]: siteStatus,
    [MSG.ENABLE_SITE]: enableSite,
    [MSG.DISABLE_SITE]: disableSite,
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
    syncRegistrations();
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(function () {
      cache.prune();
      syncRegistrations();
    });
  }
})(typeof self !== 'undefined' ? self : globalThis);
