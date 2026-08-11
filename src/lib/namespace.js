/**
 * Shared namespace, constants and defaults.
 *
 * Every file in this extension is a *classic* script (no bundler, no ES
 * modules) so that the exact same source can be loaded three different ways:
 *
 *   - as a manifest-declared content script,
 *   - via importScripts() inside the MV3 service worker,
 *   - via require() from the Node test suite.
 *
 * Each file therefore hangs its exports off a single `RMPX` global.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});

  RMPX.VERSION = '1.0.0';

  /** Message types exchanged between content scripts, popup and worker. */
  RMPX.MSG = {
    LOOKUP: 'rmpx:lookup',
    DETAIL: 'rmpx:detail',
    GET_SETTINGS: 'rmpx:get-settings',
    SET_SETTINGS: 'rmpx:set-settings',
    CACHE_STATS: 'rmpx:cache-stats',
    CLEAR_CACHE: 'rmpx:clear-cache',
  };

  RMPX.DEFAULT_SETTINGS = {
    enabled: true,
    hoverCards: true,
    /** 'auto' sniffs the campus from the page; 'manual' trusts manualSchoolKey. */
    schoolMode: 'auto',
    manualSchoolKey: 'baruch',
    showDifficulty: true,
    showWouldTakeAgain: true,
    /** Professors with fewer ratings than this render a muted badge. */
    minRatingsForBadge: 1,
  };

  /** Cache lifetimes. Misses expire sooner so new professors show up quickly. */
  RMPX.TTL = {
    HIT_MS: 7 * 24 * 60 * 60 * 1000,
    MISS_MS: 24 * 60 * 60 * 1000,
    DETAIL_MS: 3 * 24 * 60 * 60 * 1000,
    SCHOOL_MS: 90 * 24 * 60 * 60 * 1000,
  };

  /** Rate My Professors' own wording for each star value. */
  RMPX.RATING_LABELS = {
    5: 'Awesome',
    4: 'Great',
    3: 'Good',
    2: 'OK',
    1: 'Awful',
  };

  /**
   * Buckets the user asked to see at a glance. RMP itself only exposes a
   * 1-5 histogram, so we fold it into three human-readable groups.
   */
  RMPX.SENTIMENT_BUCKETS = [
    { key: 'awesome', label: 'Awesome', stars: [5, 4] },
    { key: 'good', label: 'Good', stars: [3] },
    { key: 'bad', label: 'Bad', stars: [2, 1] },
  ];

  /** Colour ramp used for badges and bars, keyed by rounded rating. */
  RMPX.ratingTone = function ratingTone(avg) {
    if (typeof avg !== 'number' || Number.isNaN(avg)) return 'unknown';
    if (avg >= 4.0) return 'great';
    if (avg >= 3.0) return 'ok';
    if (avg > 0) return 'poor';
    return 'unknown';
  };

  RMPX.professorUrl = function professorUrl(legacyId) {
    return 'https://www.ratemyprofessors.com/professor/' + encodeURIComponent(String(legacyId));
  };

  RMPX.searchUrl = function searchUrl(name, schoolLegacyId) {
    const base = 'https://www.ratemyprofessors.com/search/professors';
    const q = '?q=' + encodeURIComponent(name || '');
    return schoolLegacyId ? base + '/' + encodeURIComponent(String(schoolLegacyId)) + q : base + q;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RMPX;
})(typeof self !== 'undefined' ? self : globalThis);
