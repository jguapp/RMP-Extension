/**
 * A thin client for the Rate My Professors GraphQL endpoint.
 *
 * IMPORTANT: this is an undocumented, unofficial API. It can change without
 * notice, so every response is defensively unwrapped and any structural
 * surprise degrades to "no data" rather than throwing into the page. The
 * Authorization header below is the public token the RMP web client itself
 * ships with; no user credentials are involved and nothing is ever sent
 * anywhere other than ratemyprofessors.com.
 *
 * Runs inside the MV3 service worker, which is what allows a cross-origin
 * request from a CUNYfirst page in the first place.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});

  const ENDPOINT = 'https://www.ratemyprofessors.com/graphql';
  const AUTH = 'Basic dGVzdDp0ZXN0';
  const TIMEOUT_MS = 12000;
  const MAX_ATTEMPTS = 3;
  const MAX_CONCURRENCY = 3;
  const MIN_GAP_MS = 120;

  const SCHOOL_SEARCH_QUERY = [
    'query SchoolSearch($query: SchoolSearchQuery!) {',
    '  newSearch {',
    '    schools(query: $query) {',
    '      edges { node { id legacyId name city state } }',
    '    }',
    '  }',
    '}',
  ].join('\n');

  const TEACHER_SEARCH_QUERY = [
    'query TeacherSearch($query: TeacherSearchQuery!, $count: Int) {',
    '  newSearch {',
    '    teachers(query: $query, first: $count) {',
    '      edges {',
    '        node {',
    '          id legacyId firstName lastName department',
    '          avgRating numRatings avgDifficulty wouldTakeAgainPercent',
    '          school { id name }',
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');

  const TEACHER_DETAIL_QUERY = [
    'query TeacherDetail($id: ID!) {',
    '  node(id: $id) {',
    '    ... on Teacher {',
    '      id legacyId firstName lastName department',
    '      avgRating numRatings avgDifficulty wouldTakeAgainPercent',
    '      ratingsDistribution { r1 r2 r3 r4 r5 total }',
    '      teacherRatingTags { tagName tagCount }',
    '      school { id name }',
    '    }',
    '  }',
    '}',
  ].join('\n');

  /* ----------------------------------------------------------------------- *
   * Request scheduling
   * ----------------------------------------------------------------------- */

  let active = 0;
  let lastStartedAt = 0;
  const queue = [];

  function pump() {
    if (active >= MAX_CONCURRENCY || queue.length === 0) return;

    const gap = Date.now() - lastStartedAt;
    if (gap < MIN_GAP_MS) {
      setTimeout(pump, MIN_GAP_MS - gap);
      return;
    }

    const job = queue.shift();
    active += 1;
    lastStartedAt = Date.now();

    job.run().then(job.resolve, job.reject).finally(function () {
      active -= 1;
      pump();
    });
  }

  function schedule(run) {
    return new Promise(function (resolve, reject) {
      queue.push({ run: run, resolve: resolve, reject: reject });
      pump();
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* ----------------------------------------------------------------------- *
   * Transport
   * ----------------------------------------------------------------------- */

  async function postOnce(body) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });

      if (!response.ok) {
        const error = new Error('RMP responded ' + response.status);
        error.status = response.status;
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }

      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (parseError) {
        const error = new Error('RMP returned a non-JSON body');
        error.retryable = false;
        throw error;
      }

      if (json && Array.isArray(json.errors) && json.errors.length > 0) {
        const message = json.errors
          .map(function (e) { return (e && e.message) || 'unknown'; })
          .join('; ');
        const error = new Error('RMP GraphQL error: ' + message);
        error.retryable = false;
        throw error;
      }

      return json && json.data ? json.data : null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function post(body) {
    return schedule(async function () {
      let lastError = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          return await postOnce(body);
        } catch (err) {
          lastError = err;
          const isAbort = err && err.name === 'AbortError';
          const retryable = isAbort || !err || err.retryable !== false;
          if (!retryable || attempt === MAX_ATTEMPTS) break;
          await delay(Math.round(400 * Math.pow(2, attempt - 1) + Math.random() * 200));
        }
      }
      throw lastError || new Error('RMP request failed');
    });
  }

  /* ----------------------------------------------------------------------- *
   * Response shaping
   * ----------------------------------------------------------------------- */

  function edgesOf(container) {
    if (!container || !Array.isArray(container.edges)) return [];
    return container.edges
      .map(function (edge) { return edge && edge.node; })
      .filter(Boolean);
  }

  function numberOrNull(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  /** RMP uses 0 and -1 as "no data" sentinels; turn those into null. */
  function shapeTeacher(node) {
    if (!node) return null;
    const numRatings = numberOrNull(node.numRatings) || 0;
    const avgRating = numberOrNull(node.avgRating);
    const difficulty = numberOrNull(node.avgDifficulty);
    const wta = numberOrNull(node.wouldTakeAgainPercent);

    return {
      id: node.id || null,
      legacyId: node.legacyId != null ? String(node.legacyId) : null,
      firstName: node.firstName || '',
      lastName: node.lastName || '',
      department: node.department || '',
      numRatings: numRatings,
      avgRating: numRatings > 0 && avgRating ? avgRating : null,
      avgDifficulty: numRatings > 0 && difficulty ? difficulty : null,
      wouldTakeAgainPercent: wta != null && wta >= 0 ? wta : null,
      school: node.school ? { id: node.school.id || null, name: node.school.name || '' } : null,
    };
  }

  function shapeDistribution(distribution) {
    if (!distribution) return null;
    const counts = {
      1: numberOrNull(distribution.r1) || 0,
      2: numberOrNull(distribution.r2) || 0,
      3: numberOrNull(distribution.r3) || 0,
      4: numberOrNull(distribution.r4) || 0,
      5: numberOrNull(distribution.r5) || 0,
    };
    const total = numberOrNull(distribution.total) ||
      (counts[1] + counts[2] + counts[3] + counts[4] + counts[5]);
    if (!total) return null;
    return { counts: counts, total: total };
  }

  function shapeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags
      .filter(function (tag) { return tag && tag.tagName; })
      .map(function (tag) {
        return { name: String(tag.tagName), count: numberOrNull(tag.tagCount) || 0 };
      })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 6);
  }

  /* ----------------------------------------------------------------------- *
   * Public surface
   * ----------------------------------------------------------------------- */

  /** Resolve a campus name to RMP's opaque school id. */
  async function searchSchools(text) {
    const data = await post({
      query: SCHOOL_SEARCH_QUERY,
      variables: { query: { text: String(text || '') } },
    });
    const container = data && data.newSearch ? data.newSearch.schools : null;
    return edgesOf(container).map(function (node) {
      return {
        id: node.id || null,
        legacyId: node.legacyId != null ? String(node.legacyId) : null,
        name: node.name || '',
        city: node.city || '',
        state: node.state || '',
      };
    });
  }

  /**
   * Search professors. `schoolId` is RMP's base64 node id; omitting it
   * searches every school, which we only do as a last resort.
   */
  async function searchTeachers(text, schoolId, count) {
    const query = { text: String(text || '') };
    if (schoolId) query.schoolID = schoolId;

    const data = await post({
      query: TEACHER_SEARCH_QUERY,
      variables: { query: query, count: Number(count) || 20 },
    });
    const container = data && data.newSearch ? data.newSearch.teachers : null;
    return edgesOf(container).map(shapeTeacher).filter(Boolean);
  }

  /** Full profile including the score distribution shown in the hover card. */
  async function getTeacherDetail(nodeId) {
    const data = await post({
      query: TEACHER_DETAIL_QUERY,
      variables: { id: String(nodeId) },
    });
    const node = data && data.node;
    if (!node) return null;

    const teacher = shapeTeacher(node);
    if (!teacher) return null;
    teacher.distribution = shapeDistribution(node.ratingsDistribution);
    teacher.tags = shapeTags(node.teacherRatingTags);
    return teacher;
  }

  RMPX.rmpClient = {
    ENDPOINT: ENDPOINT,
    searchSchools: searchSchools,
    searchTeachers: searchTeachers,
    getTeacherDetail: getTeacherDetail,
    // exposed for tests
    _shapeTeacher: shapeTeacher,
    _shapeDistribution: shapeDistribution,
    _shapeTags: shapeTags,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RMPX.rmpClient;
})(typeof self !== 'undefined' ? self : globalThis);
