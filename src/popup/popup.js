/**
 * Popup controller.
 *
 * The popup owns no state of its own: it reads settings from the service
 * worker, writes changes straight back, and lets chrome.storage.onChanged
 * propagate them to any open CUNYfirst tab.
 */
(function (root) {
  'use strict';

  const RMPX = root.RMPX;
  const { MSG } = RMPX;

  const TOGGLES = ['enabled', 'hoverCards', 'showDifficulty', 'showWouldTakeAgain'];

  const elements = {
    enabled: document.getElementById('enabled'),
    hoverCards: document.getElementById('hoverCards'),
    autoDetect: document.getElementById('autoDetect'),
    manualSchoolKey: document.getElementById('manualSchoolKey'),
    showDifficulty: document.getElementById('showDifficulty'),
    showWouldTakeAgain: document.getElementById('showWouldTakeAgain'),
    schoolLabel: document.getElementById('schoolLabel'),
    cacheStats: document.getElementById('cacheStats'),
    clearCache: document.getElementById('clearCache'),
    siteSection: document.getElementById('siteSection'),
    siteOrigin: document.getElementById('siteOrigin'),
    siteNote: document.getElementById('siteNote'),
    siteToggle: document.getElementById('siteToggle'),
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

  function populateSchools() {
    const fragment = document.createDocumentFragment();
    RMPX.schools.listSchools()
      .slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (school) {
        const option = document.createElement('option');
        option.value = school.key;
        option.textContent = school.name;
        fragment.appendChild(option);
      });
    elements.manualSchoolKey.appendChild(fragment);
  }

  function render(settings) {
    TOGGLES.forEach(function (key) {
      if (elements[key]) elements[key].checked = Boolean(settings[key]);
    });

    const auto = settings.schoolMode !== 'manual';
    elements.autoDetect.checked = auto;
    elements.manualSchoolKey.value = settings.manualSchoolKey || 'baruch';
    elements.schoolLabel.textContent = auto ? 'Fall back to' : 'Always use';

    // Everything except the master switch is meaningless while disabled.
    const disabled = !settings.enabled;
    ['hoverCards', 'autoDetect', 'manualSchoolKey', 'showDifficulty', 'showWouldTakeAgain']
      .forEach(function (key) {
        if (elements[key]) elements[key].disabled = disabled;
      });
  }

  async function patch(changes) {
    const response = await sendMessage(MSG.SET_SETTINGS, { settings: changes });
    if (response && response.ok && response.settings) render(response.settings);
  }

  async function refreshCacheStats() {
    const response = await sendMessage(MSG.CACHE_STATS, {});
    if (!response || !response.ok || !response.stats) {
      elements.cacheStats.textContent = 'Cache unavailable.';
      return;
    }
    const { fresh, expired } = response.stats;
    if (fresh === 0 && expired === 0) {
      elements.cacheStats.textContent = 'Nothing cached yet.';
      return;
    }
    elements.cacheStats.textContent =
      fresh + ' professor' + (fresh === 1 ? '' : 's') + ' cached' +
      (expired > 0 ? ', ' + expired + ' expired' : '') + '.';
  }

  /* ----------------------------------------------------------------------- *
   * Per-site activation
   *
   * Schedule Builder does not live at the same address for every campus. When
   * the popup is opened over a page the manifest does not cover, this offers
   * to grant that one origin and register the content scripts there, so the
   * extension can be pointed at a new URL without a code change.
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

  function renderSite(status) {
    if (!status || !status.supported) {
      elements.siteSection.hidden = true;
      return;
    }

    elements.siteSection.hidden = false;
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
      elements.siteSection.hidden = true;
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

  function wireEvents() {
    elements.siteToggle.addEventListener('click', onSiteToggle);

    TOGGLES.forEach(function (key) {
      if (!elements[key]) return;
      elements[key].addEventListener('change', function () {
        const change = {};
        change[key] = elements[key].checked;
        patch(change);
      });
    });

    elements.autoDetect.addEventListener('change', function () {
      patch({ schoolMode: elements.autoDetect.checked ? 'auto' : 'manual' });
    });

    elements.manualSchoolKey.addEventListener('change', function () {
      patch({ manualSchoolKey: elements.manualSchoolKey.value });
    });

    elements.clearCache.addEventListener('click', async function () {
      elements.clearCache.disabled = true;
      elements.clearCache.textContent = 'Clearing…';
      await sendMessage(MSG.CLEAR_CACHE, {});
      await refreshCacheStats();
      elements.clearCache.textContent = 'Clear cached ratings';
      elements.clearCache.disabled = false;
    });
  }

  async function init() {
    populateSchools();
    wireEvents();

    const response = await sendMessage(MSG.GET_SETTINGS, {});
    render(Object.assign({}, RMPX.DEFAULT_SETTINGS, (response && response.settings) || {}));
    refreshCacheStats();
    refreshSite();
  }

  document.addEventListener('DOMContentLoaded', init);
})(typeof self !== 'undefined' ? self : globalThis);
