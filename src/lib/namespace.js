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

  RMPX.VERSION = '1.2.0';

  /**
   * The content script bundle, in load order. Kept here so the service worker
   * can register the same set dynamically on sites the user opts into. A test
   * asserts this stays identical to manifest.json.
   */
  RMPX.CONTENT_JS = [
    'src/lib/namespace.js',
    'src/lib/name-utils.js',
    'src/lib/matching.js',
    'src/lib/schools.js',
    'src/lib/subjects.js',
    'src/content/scanner.js',
    'src/content/badge.js',
    'src/content/hovercard.js',
    'src/content/content.js',
  ];

  RMPX.CONTENT_CSS = ['src/content/styles.css'];

  /**
   * The background bundle, in load order.
   *
   * Chrome runs the background as an MV3 service worker and pulls these in with
   * importScripts(). Firefox has no service worker in MV3 and Safari is happier
   * without one, so both run the background as an event page instead -- where
   * importScripts does not exist and the manifest has to list these files
   * itself. tools/manifests.js builds that list from here, and a test asserts
   * it still matches what the worker imports.
   */
  RMPX.BACKGROUND_JS = [
    'src/lib/namespace.js',
    'src/lib/name-utils.js',
    'src/lib/matching.js',
    'src/lib/schools.js',
    'src/lib/origins.js',
    'src/lib/cache.js',
    'src/lib/rmp-client.js',
  ];

  RMPX.BACKGROUND_ENTRY = 'src/background/service-worker.js';

  /** Message types exchanged between content scripts, popup and worker. */
  RMPX.MSG = {
    LOOKUP: 'rmpx:lookup',
    DETAIL: 'rmpx:detail',
    GET_SETTINGS: 'rmpx:get-settings',
    SET_SETTINGS: 'rmpx:set-settings',
    SITE_STATUS: 'rmpx:site-status',
    ENABLE_SITE: 'rmpx:enable-site',
    DISABLE_SITE: 'rmpx:disable-site',
  };

  /**
   * The only settings a user can change, and therefore the only keys ever read
   * back out of storage.
   *
   * Everything else in DEFAULT_SETTINGS is fixed behaviour. Keeping the read
   * list this narrow is deliberate: an older build shipped a full settings UI,
   * so somebody out there has an `enabled: false` sitting in storage, and
   * honouring it now would switch the extension off with no UI left to switch
   * it back on.
   */
  RMPX.STORED_SETTINGS = ['schoolMode', 'manualSchoolKey'];

  /**
   * Starting values for everything the extension can be told to do. Only the
   * two keys in STORED_SETTINGS are ever overridden by the user; the rest are
   * fixed behaviour, kept here so the values have one home rather than being
   * scattered as literals across the content scripts.
   */
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
