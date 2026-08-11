/**
 * Content script entry point.
 *
 * Responsibilities, in order: work out which CUNY campus this page belongs to,
 * scan for instructor names, annotate them, ask the service worker for ratings,
 * and keep doing that as the single-page app swaps its contents.
 *
 * Everything here is wrapped so that a failure degrades to "no badges" rather
 * than breaking the registration page a student is trying to use.
 */
(function (root) {
  'use strict';

  const RMPX = root.RMPX;
  if (!RMPX || !RMPX.scanner || !RMPX.badge) return;

  const { MSG } = RMPX;
  const scanner = RMPX.scanner;
  const badge = RMPX.badge;
  const hovercard = RMPX.hovercard;
  const schools = RMPX.schools;

  const RESCAN_DEBOUNCE_MS = 350;
  const MAX_SITES_PER_PASS = 120;

  let settings = Object.assign({}, RMPX.DEFAULT_SETTINGS);
  let schoolKey = null;
  let observer = null;
  let rescanTimer = null;
  let scanning = false;

  /** anchor element -> { result, settings } for the hover card. */
  const contextByAnchor = new WeakMap();

  /* ----------------------------------------------------------------------- *
   * Messaging
   * ----------------------------------------------------------------------- */

  function sendMessage(type, payload) {
    return new Promise(function (resolve) {
      let settled = false;
      const done = function (value) {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      try {
        chrome.runtime.sendMessage({ type: type, payload: payload || {} }, function (response) {
          // A reloaded extension invalidates the context mid-flight; swallow it.
          if (chrome.runtime.lastError) return done(null);
          done(response || null);
        });
      } catch (err) {
        done(null);
      }
    });
  }

  /* ----------------------------------------------------------------------- *
   * Campus detection
   * ----------------------------------------------------------------------- */

  /** Read a PeopleSoft-style institution picker if one is on the page. */
  function institutionFromControls() {
    let selects = [];
    try {
      selects = Array.prototype.slice.call(
        document.querySelectorAll('select[id*="INSTITUTION" i], select[name*="INSTITUTION" i], select[id*="institution" i]')
      );
    } catch (err) {
      return null;
    }

    for (let i = 0; i < selects.length; i += 1) {
      const select = selects[i];
      const option = select.options && select.options[select.selectedIndex];
      const label = option ? option.textContent : '';
      const byText = schools.detectSchoolFromText(label);
      if (byText) return byText.key;
      const byCode = schools.detectSchoolFromCode(select.value || (option && option.value));
      if (byCode) return byCode;
    }
    return null;
  }

  function detectSchoolKey() {
    if (settings.schoolMode === 'manual' && settings.manualSchoolKey) {
      return settings.manualSchoolKey;
    }

    const fromControls = institutionFromControls();
    if (fromControls) return fromControls;

    const titleHit = schools.detectSchoolFromText(document.title || '');
    if (titleHit) return titleHit.key;

    // Headers and nav are where campus branding usually lives.
    let chromeText = '';
    try {
      const parts = document.querySelectorAll('header, nav, h1, h2, .navbar, [class*="header" i]');
      for (let i = 0; i < parts.length && chromeText.length < 3000; i += 1) {
        chromeText += ' ' + (parts[i].textContent || '');
      }
    } catch (err) {
      chromeText = '';
    }
    const chromeHit = schools.detectSchoolFromText(chromeText);
    if (chromeHit) return chromeHit.key;

    const urlHit = schools.detectSchoolFromText(
      location.hostname.replace(/[.-]/g, ' ') + ' ' + location.pathname.replace(/[/_-]/g, ' ')
    );
    if (urlHit) return urlHit.key;

    const bodyHit = schools.detectSchoolFromText((document.body.textContent || '').slice(0, 6000));
    if (bodyHit) return bodyHit.key;

    return settings.manualSchoolKey || null;
  }

  /* ----------------------------------------------------------------------- *
   * Lookup + paint
   * ----------------------------------------------------------------------- */

  async function resolveOne(entry) {
    badge.paintBadge(entry.badge, { status: 'loading' }, settings);

    const response = await sendMessage(MSG.LOOKUP, {
      name: entry.person,
      schoolKey: schoolKey,
      subjectHint: entry.subjectHint,
    });

    if (!response || !response.ok) {
      const failure = { status: 'error', message: (response && response.error) || 'no response' };
      badge.paintBadge(entry.badge, failure, settings);
      contextByAnchor.set(entry.anchor, { result: failure, settings: settings });
      return;
    }

    badge.paintBadge(entry.badge, response, settings);
    badge.updateAnchor(entry.anchor, response);
    contextByAnchor.set(entry.anchor, { result: response, settings: settings });
  }

  function wireHover(entry) {
    if (!settings.hoverCards || !hovercard) return;
    hovercard.attach(entry.anchor, function () {
      return contextByAnchor.get(entry.anchor) || null;
    });
  }

  /* ----------------------------------------------------------------------- *
   * Scanning
   * ----------------------------------------------------------------------- */

  /**
   * Leave exactly one breadcrumb per page when we are running but found
   * nobody. Without it, "extension not injected" and "markup not recognised"
   * look identical from the outside -- both are just a page with no badges.
   */
  let announcedEmpty = false;

  function announceEmptyScan() {
    if (announcedEmpty) return;
    announcedEmpty = true;
    const counts = scanner.report();
    console.info(
      '[RMP for CUNYfirst] active on this page but found no instructor names. ' +
      'Strategy hits — marked element: ' + counts.explicit +
      ', beside marker: ' + counts.sibling +
      ', table column: ' + counts.table +
      ', label: ' + counts.label + '. ' +
      'If names are visible on screen, this page uses markup the scanner does ' +
      'not recognise yet; please report it with the surrounding HTML.'
    );
  }

  function scanAndAnnotate(scope) {
    if (scanning || !settings.enabled) return;
    scanning = true;

    try {
      const sites = scanner.scan(scope || document.body).slice(0, MAX_SITES_PER_PASS);
      if (!sites.length) {
        announceEmptyScan();
        return;
      }
      announcedEmpty = true;

      const entries = [];
      sites.forEach(function (site) {
        try {
          badge.annotate(site).forEach(function (entry) { entries.push(entry); });
        } catch (err) {
          // One malformed cell must not abort the whole pass.
        }
      });

      entries.forEach(function (entry) {
        wireHover(entry);
        resolveOne(entry).catch(function () { /* already surfaced on the badge */ });
      });
    } catch (err) {
      // Never let a scan failure escape into the host page.
    } finally {
      scanning = false;
    }
  }

  function scheduleRescan() {
    window.clearTimeout(rescanTimer);
    rescanTimer = window.setTimeout(function () {
      const run = function () { scanAndAnnotate(document.body); };
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 1200 });
      } else {
        run();
      }
    }, RESCAN_DEBOUNCE_MS);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i += 1) {
        const mutation = mutations[i];
        // Ignore the nodes we just injected ourselves.
        const target = mutation.target;
        if (target && target.closest && target.closest('[data-rmpx]')) continue;
        if (mutation.addedNodes && mutation.addedNodes.length) {
          scheduleRescan();
          return;
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  /* ----------------------------------------------------------------------- *
   * Lifecycle
   * ----------------------------------------------------------------------- */

  function teardown() {
    stopObserver();
    window.clearTimeout(rescanTimer);
    if (hovercard) hovercard.hide();
    badge.removeAll(document);
  }

  async function applySettings(next) {
    const wasEnabled = settings.enabled;
    const previousSchool = schoolKey;
    settings = Object.assign({}, RMPX.DEFAULT_SETTINGS, next || {});

    if (!settings.enabled) {
      if (wasEnabled) teardown();
      return;
    }

    schoolKey = detectSchoolKey();

    // Changing campus invalidates every badge on the page.
    if (wasEnabled && previousSchool && previousSchool !== schoolKey) {
      badge.removeAll(document);
    }

    startObserver();
    scanAndAnnotate(document.body);
  }

  async function init() {
    if (!document.body) return;

    const response = await sendMessage(MSG.GET_SETTINGS, {});
    const loaded = response && response.ok && response.settings ? response.settings : {};
    if (hovercard) {
      hovercard.setDetailProvider(async function (professor) {
        if (!professor || !professor.id) return null;
        const detail = await sendMessage(MSG.DETAIL, { nodeId: professor.id });
        if (!detail || !detail.ok || detail.status !== 'ok') return null;
        return detail.professor;
      });
    }

    await applySettings(loaded);
  }

  // React to the popup toggling things while a page is open.
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync' && area !== 'local') return;
      const patch = {};
      let touched = false;
      Object.keys(changes).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(RMPX.DEFAULT_SETTINGS, key)) {
          patch[key] = changes[key].newValue;
          touched = true;
        }
      });
      if (touched) applySettings(Object.assign({}, settings, patch));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(typeof self !== 'undefined' ? self : globalThis);
