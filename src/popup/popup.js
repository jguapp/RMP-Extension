/**
 * Popup controller.
 *
 * The extension is deliberately almost settings-free -- everything runs on the
 * defaults in namespace.js -- so the popup carries only the two things that
 * genuinely cannot be defaults:
 *
 *   Campus        Detection reads the college off the page, but plenty of
 *                 pages never name it. The fallback is a guess, and a wrong
 *                 guess means ratings for a different school's professor, so
 *                 the user gets to pin it.
 *
 *   This site     Schedule Builder is not at the same address for every
 *                 campus, and reaching one the manifest does not cover needs a
 *                 host permission, which the browser only grants from a click.
 */
(function (root) {
  'use strict';

  const RMPX = root.RMPX;
  const { MSG } = RMPX;

  /** Sentinel for "work it out from the page" -- no campus uses this key. */
  const AUTO = 'auto';

  const elements = {
    campus: document.getElementById('campus'),
    campusNote: document.getElementById('campusNote'),
    siteSection: document.getElementById('siteSection'),
    siteOrigin: document.getElementById('siteOrigin'),
    siteNote: document.getElementById('siteNote'),
    siteToggle: document.getElementById('siteToggle'),
    idleSection: document.getElementById('idleSection'),
  };

  /** Origin of the tab this popup was opened over, or null if unreadable. */
  let currentOrigin = null;

  function sendMessage(type, payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: type, payload: payload || {} }, function (response) {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(response || null);
        });
      } catch (err) {
        resolve(null);
      }
    });
  }

  /* ----------------------------------------------------------------------- *
   * Campus
   * ----------------------------------------------------------------------- */

  function populateCampuses() {
    const fragment = document.createDocumentFragment();

    const auto = document.createElement('option');
    auto.value = AUTO;
    auto.textContent = 'Detect automatically';
    fragment.appendChild(auto);

    RMPX.schools.listSchools()
      .slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (school) {
        const option = document.createElement('option');
        option.value = school.key;
        option.textContent = school.name;
        fragment.appendChild(option);
      });

    elements.campus.appendChild(fragment);
  }

  function renderCampus(settings) {
    const wanted = settings.schoolMode === 'manual' && settings.manualSchoolKey
      ? settings.manualSchoolKey
      : AUTO;

    elements.campus.value = wanted;
    // Assigning a value with no matching <option> leaves the select showing
    // nothing at all, so fall back rather than render a blank control.
    if (!elements.campus.value) elements.campus.value = AUTO;

    elements.campusNote.textContent = elements.campus.value === AUTO
      ? 'Read from the page. Pick a college if it guesses wrong.'
      : 'Always used, whatever the page says.';
  }

  async function onCampusChange() {
    const value = elements.campus.value;
    const patch = value === AUTO
      ? { schoolMode: 'auto' }
      : { schoolMode: 'manual', manualSchoolKey: value };

    const response = await sendMessage(MSG.SET_SETTINGS, { settings: patch });
    if (response && response.ok && response.settings) renderCampus(response.settings);
  }

  /* ----------------------------------------------------------------------- *
   * Per-site activation
   * ----------------------------------------------------------------------- */

  function activeTabOrigin() {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (chrome.runtime.lastError) return resolve(null);
          const url = tabs && tabs[0] && tabs[0].url;
          if (!url) return resolve(null);
          try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return resolve(null);
            resolve(parsed.origin);
          } catch (err) {
            resolve(null);
          }
        });
      } catch (err) {
        resolve(null);
      }
    });
  }

  /** Show the site panel, or the standing explanation when it does not apply. */
  function renderSite(status) {
    const applicable = Boolean(status && status.supported);
    elements.siteSection.hidden = !applicable;
    elements.idleSection.hidden = applicable;
    if (!applicable) return;

    elements.siteOrigin.textContent = status.origin.replace(/^https?:\/\//, '');
    elements.siteOrigin.setAttribute('data-state', status.enabled ? 'on' : 'off');

    if (status.builtIn) {
      elements.siteNote.textContent = 'Supported out of the box.';
      elements.siteToggle.hidden = true;
      return;
    }

    elements.siteToggle.hidden = false;
    if (status.enabled) {
      elements.siteNote.textContent = 'Enabled by you. Reload the page to see changes.';
      elements.siteToggle.textContent = 'Turn off for this site';
    } else {
      elements.siteNote.textContent =
        'Not covered by default. Turn it on if this is your Schedule Builder.';
      elements.siteToggle.textContent = 'Turn on for this site';
    }
  }

  async function refreshSite() {
    currentOrigin = await activeTabOrigin();
    if (!currentOrigin) {
      renderSite(null);
      return;
    }
    const response = await sendMessage(MSG.SITE_STATUS, { origin: currentOrigin });
    renderSite(response && response.ok ? response : null);
  }

  /** Must run inside the click handler -- permissions.request needs a gesture. */
  function requestOrigin(origin) {
    return new Promise(function (resolve) {
      try {
        chrome.permissions.request({ origins: [origin + '/*'] }, function (granted) {
          void chrome.runtime.lastError;
          resolve(Boolean(granted));
        });
      } catch (err) {
        resolve(false);
      }
    });
  }

  async function onSiteToggle() {
    if (!currentOrigin) return;
    elements.siteToggle.disabled = true;

    const status = await sendMessage(MSG.SITE_STATUS, { origin: currentOrigin });
    const enabled = Boolean(status && status.enabled);

    if (enabled) {
      await sendMessage(MSG.DISABLE_SITE, { origin: currentOrigin });
    } else {
      const granted = await requestOrigin(currentOrigin);
      if (granted) {
        await sendMessage(MSG.ENABLE_SITE, { origin: currentOrigin });
      }
    }

    await refreshSite();
    elements.siteToggle.disabled = false;
  }

  async function init() {
    populateCampuses();
    elements.campus.addEventListener('change', onCampusChange);
    elements.siteToggle.addEventListener('click', onSiteToggle);

    refreshSite();

    const response = await sendMessage(MSG.GET_SETTINGS, {});
    renderCampus(Object.assign(
      {}, RMPX.DEFAULT_SETTINGS, (response && response.settings) || {}
    ));
  }

  document.addEventListener('DOMContentLoaded', init);
})(typeof self !== 'undefined' ? self : globalThis);
