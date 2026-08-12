/**
 * One manifest, three browsers.
 *
 * The extension source is identical everywhere; only the manifest genuinely
 * differs, so it is generated from a single base rather than kept as three
 * files that drift. `node tools/build.js` writes the results.
 *
 * What actually differs, and why:
 *
 *   background   Chrome runs an MV3 service worker. Firefox has no service
 *                worker in MV3 at all -- it runs event pages -- and Safari
 *                supports event pages with fewer sharp edges than its service
 *                worker. So Chrome gets `service_worker` and the other two get
 *                `scripts`, which must list the libraries the worker would
 *                otherwise have pulled in with importScripts().
 *
 *   gecko id     Firefox needs a stable extension id to sign and to keep
 *                granted permissions across updates. Chrome and Safari derive
 *                theirs from the packaging instead.
 *
 *   min version  Firefox only grants MV3 host permissions at install from 127,
 *                and only understands optional_host_permissions from 128.
 *                Below that the extension installs but never reaches RMP, so
 *                128 is the floor rather than a suggestion.
 *
 * Safari needs no key of its own; it is Chrome's manifest with the event-page
 * background. The work of shipping it is the Xcode wrapper, not the manifest.
 */
'use strict';

require('../src/lib/namespace.js');

const RMPX = globalThis.RMPX;

const TARGETS = ['chrome', 'firefox', 'safari'];

/** Firefox add-on id. Not a URL that has to resolve -- just a unique name. */
const GECKO_ID = 'rmp-cunyfirst@jguapp.github.io';
const GECKO_MIN_VERSION = '128.0';

function base() {
  return {
    manifest_version: 3,
    name: 'RMP for CUNYfirst Schedule Builder',
    version: RMPX.VERSION,
    description: 'Shows Rate My Professors ratings, profile links and a hover ' +
      'preview of the score breakdown directly inside CUNYfirst Schedule Builder.',

    permissions: ['storage', 'scripting', 'activeTab'],

    host_permissions: [
      'https://www.ratemyprofessors.com/*',
      'https://*.cuny.edu/*',
      'https://*.collegescheduler.com/*',
    ],

    optional_host_permissions: ['https://*/*'],

    content_scripts: [
      {
        matches: [
          'https://*.cuny.edu/*',
          'https://*.collegescheduler.com/*',
        ],
        js: RMPX.CONTENT_JS.slice(),
        css: RMPX.CONTENT_CSS.slice(),
        run_at: 'document_idle',
        all_frames: true,
      },
    ],

    action: {
      default_title: 'RMP for CUNYfirst',
      default_popup: 'src/popup/popup.html',
      default_icon: icons(),
    },

    icons: icons(),
  };
}

function icons() {
  return {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  };
}

/** Event-page background: the libraries first, then the worker itself. */
function eventPageScripts() {
  return RMPX.BACKGROUND_JS.concat([RMPX.BACKGROUND_ENTRY]);
}

function buildManifest(target) {
  if (TARGETS.indexOf(target) === -1) {
    throw new Error('unknown target: ' + target + ' (expected ' + TARGETS.join(', ') + ')');
  }

  const manifest = base();

  if (target === 'chrome') {
    manifest.minimum_chrome_version = '102';
    manifest.background = { service_worker: RMPX.BACKGROUND_ENTRY };
    return manifest;
  }

  manifest.background = { scripts: eventPageScripts() };

  if (target === 'firefox') {
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: GECKO_MIN_VERSION,
        // Mozilla is making this declaration mandatory. "none" is the literal
        // answer here: nothing is collected, transmitted or stored anywhere but
        // this browser's own cache. Older Firefox ignores the key.
        data_collection_permissions: { required: ['none'] },
      },
    };
  }

  return manifest;
}

module.exports = {
  TARGETS: TARGETS,
  GECKO_ID: GECKO_ID,
  GECKO_MIN_VERSION: GECKO_MIN_VERSION,
  buildManifest: buildManifest,
  eventPageScripts: eventPageScripts,
};
