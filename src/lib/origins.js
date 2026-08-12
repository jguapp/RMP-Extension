/**
 * Which origins this extension may inject into.
 *
 * Three categories, and the difference between them is load-bearing:
 *
 *   statically covered  The manifest's own content_scripts already match these
 *                       (*.cuny.edu, *.collegescheduler.com). Nothing to do.
 *
 *   the API host        ratemyprofessors.com is a host permission so the
 *                       background can *fetch* ratings. It is not a page to
 *                       annotate. Treating it as just another granted origin
 *                       is what put badges on RMP's own "similar professors"
 *                       list, which is the one place they are pure noise.
 *
 *   everything else     A campus serving Schedule Builder from somewhere the
 *                       manifest does not cover. Fair game, but only once the
 *                       user has explicitly opted the site in.
 *
 * Kept in its own file because chrome.permissions.getAll() hands back all three
 * mixed together, so the sorting has to be exactly right -- and being a plain
 * module means it can be tested under node instead of only in a browser.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});

  const STATIC_PATTERN = /^https:\/\/([a-z0-9-]+\.)*(cuny\.edu|collegescheduler\.com)$/i;
  const API_PATTERN = /^https:\/\/([a-z0-9-]+\.)*ratemyprofessors\.com$/i;

  /** "https://x.cuny.edu/*" and "https://x.cuny.edu/" both mean the origin. */
  function normalize(origin) {
    return String(origin || '').replace(/\/\*$/, '').replace(/\/+$/, '');
  }

  function isStaticallyCovered(origin) {
    return STATIC_PATTERN.test(normalize(origin));
  }

  function isApiHost(origin) {
    return API_PATTERN.test(normalize(origin));
  }

  /**
   * True when registering content scripts on this origin would be legitimate:
   * a real web origin that the manifest does not already cover and that is not
   * the ratings API itself.
   */
  function isOptInCandidate(origin) {
    const clean = normalize(origin);
    if (!/^https?:\/\/[^/]+$/i.test(clean)) return false;
    return !isStaticallyCovered(clean) && !isApiHost(clean);
  }

  RMPX.origins = {
    normalize: normalize,
    isStaticallyCovered: isStaticallyCovered,
    isApiHost: isApiHost,
    isOptInCandidate: isOptInCandidate,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RMPX.origins;
})(typeof self !== 'undefined' ? self : globalThis);
