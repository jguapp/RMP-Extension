'use strict';

/**
 * Structural checks, run against every browser target.
 *
 * Content scripts never execute under Node, so a typo in a manifest path or a
 * syntax error in the DOM layer would otherwise only show up when loading the
 * unpacked extension in a browser -- and for Safari, not until someone with a
 * Mac tried it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { TARGETS, GECKO_ID, buildManifest, eventPageScripts } = require('../tools/manifests.js');

require('../src/lib/namespace.js');
const RMPX = globalThis.RMPX;

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

/* -------------------------------------------------------------------------- *
 * Everything that must hold for all three browsers
 * -------------------------------------------------------------------------- */

TARGETS.forEach(function (target) {
  const manifest = buildManifest(target);
  const label = '[' + target + '] ';

  test(label + 'declares MV3', function () {
    assert.strictEqual(manifest.manifest_version, 3);
    assert.ok(manifest.name);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.strictEqual(manifest.version, RMPX.VERSION);
  });

  test(label + 'fits the extension store field limits', function () {
    // The Chrome Web Store rejects these at *upload*, before review, so a
    // long description costs a round trip rather than producing a warning.
    assert.ok(manifest.description.length <= 132,
      'description is ' + manifest.description.length + ' chars, limit is 132');
    assert.ok(manifest.name.length <= 75,
      'name is ' + manifest.name.length + ' chars, limit is 75');
    assert.ok(manifest.icons['128'], 'a 128px icon is required for a listing');
  });

  test(label + 'every declared icon exists', function () {
    Object.values(manifest.icons).forEach(function (file) {
      assert.ok(exists(file), 'missing icon: ' + file);
    });
    Object.values(manifest.action.default_icon).forEach(function (file) {
      assert.ok(exists(file), 'missing action icon: ' + file);
    });
  });

  test(label + 'every background file exists and loads in dependency order', function () {
    const files = manifest.background.service_worker
      ? [manifest.background.service_worker]
      : manifest.background.scripts;

    files.forEach(function (file) {
      assert.ok(exists(file), 'missing background file: ' + file);
    });
    assert.strictEqual(files[files.length - 1], RMPX.BACKGROUND_ENTRY,
      'the entry point must load last');

    if (files.length > 1) {
      assert.strictEqual(files[0], 'src/lib/namespace.js', 'namespace.js must load first');
    }
  });

  test(label + 'every content script file exists', function () {
    manifest.content_scripts.forEach(function (entry) {
      entry.js.forEach(function (file) {
        assert.ok(exists(file), 'missing content script: ' + file);
      });
      (entry.css || []).forEach(function (file) {
        assert.ok(exists(file), 'missing stylesheet: ' + file);
      });
    });
  });

  test(label + 'the popup and its assets exist', function () {
    const popup = manifest.action.default_popup;
    assert.ok(exists(popup));
    const html = fs.readFileSync(path.join(ROOT, popup), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(function (m) { return m[1]; });
    assert.ok(refs.length > 0);
    refs.forEach(function (ref) {
      if (/^https?:/.test(ref)) return;
      const resolved = path.join(path.dirname(path.join(ROOT, popup)), ref);
      assert.ok(fs.existsSync(resolved), 'popup references a missing file: ' + ref);
    });
  });

  test(label + 'content scripts are listed in dependency order', function () {
    const js = manifest.content_scripts[0].js;
    const indexOf = function (needle) {
      return js.findIndex(function (file) { return file.endsWith(needle); });
    };

    assert.ok(indexOf('namespace.js') === 0, 'namespace.js must load first');
    assert.ok(indexOf('name-utils.js') < indexOf('matching.js'), 'matching.js depends on name-utils.js');
    assert.ok(indexOf('name-utils.js') < indexOf('scanner.js'), 'scanner.js depends on name-utils.js');
    assert.ok(indexOf('subjects.js') < indexOf('scanner.js'), 'scanner.js depends on subjects.js');
    assert.ok(indexOf('scanner.js') < indexOf('content.js'), 'content.js orchestrates the rest');
    assert.ok(indexOf('badge.js') < indexOf('content.js'));
    assert.ok(indexOf('hovercard.js') < indexOf('content.js'));
  });

  test(label + 'content script matches cover CUNY and College Scheduler broadly', function () {
    const matches = manifest.content_scripts[0].matches;
    // Schedule Builder's subdomain varies by campus; matching the whole cuny.edu
    // tree is what keeps the extension from silently never injecting.
    assert.ok(matches.includes('https://*.cuny.edu/*'), 'must cover all of cuny.edu');
    assert.ok(matches.includes('https://*.collegescheduler.com/*'));
  });

  test(label + 'never injects into Rate My Professors itself', function () {
    // RMP is a host permission so the background can fetch from it. Annotating
    // its own pages -- the "similar professors" list especially -- is noise.
    manifest.content_scripts[0].matches.forEach(function (match) {
      assert.ok(!/ratemyprofessors/i.test(match),
        'content scripts must not match the ratings API: ' + match);
    });
  });

  test(label + 'per-site opt-in is wired up', function () {
    assert.ok(manifest.permissions.includes('scripting'),
      'dynamic content script registration needs the scripting permission');
    assert.ok(manifest.permissions.includes('activeTab'),
      'reading the current tab origin needs activeTab');
    assert.ok(Array.isArray(manifest.optional_host_permissions) &&
      manifest.optional_host_permissions.length > 0,
      'opting a new site in needs an optional host permission to request');
  });

  test(label + 'the shared content script list matches the manifest exactly', function () {
    // The background registers this same list on opted-in sites. If the two
    // drift, dynamically enabled sites silently load a different bundle.
    assert.deepStrictEqual(RMPX.CONTENT_JS, manifest.content_scripts[0].js);
    assert.deepStrictEqual(RMPX.CONTENT_CSS, manifest.content_scripts[0].css);
  });

  test(label + 'host permissions cover ratemyprofessors and every injected origin', function () {
    const hosts = manifest.host_permissions;
    assert.ok(hosts.some(function (h) { return h.includes('ratemyprofessors.com'); }));
    manifest.content_scripts[0].matches.forEach(function (match) {
      assert.ok(hosts.includes(match), 'content script origin lacks host permission: ' + match);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Per-browser differences
 * -------------------------------------------------------------------------- */

test('[chrome] runs the background as an MV3 service worker', function () {
  const manifest = buildManifest('chrome');
  assert.strictEqual(manifest.background.service_worker, RMPX.BACKGROUND_ENTRY);
  assert.ok(!manifest.background.scripts, 'Chrome must not be given an event page');
  assert.ok(manifest.minimum_chrome_version);
});

test('[firefox] runs the background as an event page, not a service worker', function () {
  // Firefox has no service worker in MV3 at all. A manifest that only declares
  // one installs and then never runs any background code.
  const manifest = buildManifest('firefox');
  assert.ok(!manifest.background.service_worker,
    'Firefox MV3 does not support background.service_worker');
  assert.deepStrictEqual(manifest.background.scripts, eventPageScripts());
});

test('[firefox] declares a stable add-on id and a version floor', function () {
  const gecko = buildManifest('firefox').browser_specific_settings.gecko;
  assert.strictEqual(gecko.id, GECKO_ID);
  // 127 grants MV3 host permissions at install; 128 understands
  // optional_host_permissions. Below that the extension cannot reach RMP.
  assert.ok(parseInt(gecko.strict_min_version, 10) >= 128,
    'optional_host_permissions needs Firefox 128+');
});

test('[safari] runs the background as an event page', function () {
  const manifest = buildManifest('safari');
  assert.ok(!manifest.background.service_worker);
  assert.deepStrictEqual(manifest.background.scripts, eventPageScripts());
  assert.ok(!manifest.browser_specific_settings, 'gecko settings are Firefox-only');
});

test('an unknown target is rejected rather than silently built', function () {
  assert.throws(function () { buildManifest('edge'); }, /unknown target/);
});

/* -------------------------------------------------------------------------- *
 * The committed manifest and the generator cannot drift
 * -------------------------------------------------------------------------- */

test('the checked-in manifest.json matches the generated Chrome one', function () {
  // The repo root doubles as a loadable Chrome extension, and its manifest is
  // hand-maintained -- the build never rewrites it. This compares the parsed
  // objects, so formatting is free but content cannot drift. If it fails, edit
  // manifest.json to match tools/manifests.js.
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.deepStrictEqual(committed, buildManifest('chrome'));
});

test('the background imports exactly the libraries the event pages preload', function () {
  // Chrome pulls these in at runtime with importScripts; Firefox and Safari get
  // them from the manifest. If the two lists disagree, one browser is missing a
  // dependency and fails only once something calls into it.
  const source = fs.readFileSync(path.join(ROOT, RMPX.BACKGROUND_ENTRY), 'utf8');
  const imported = [...source.matchAll(/'\/(src\/lib\/[a-z-]+\.js)'/g)]
    .map(function (m) { return m[1]; });

  assert.deepStrictEqual(imported, RMPX.BACKGROUND_JS);
});

test('every stored setting is a real setting', function () {
  // A typo here means the popup writes a key nothing ever reads, and the
  // setting silently does nothing.
  RMPX.STORED_SETTINGS.forEach(function (key) {
    assert.ok(Object.prototype.hasOwnProperty.call(RMPX.DEFAULT_SETTINGS, key),
      'STORED_SETTINGS names a key that is not in DEFAULT_SETTINGS: ' + key);
  });
});

test('the default campus is a campus that actually exists', function () {
  require('../src/lib/schools.js');
  assert.ok(RMPX.schools.getSchool(RMPX.DEFAULT_SETTINGS.manualSchoolKey),
    'the fallback campus must resolve, or every lookup fails when detection does');
});

test('the importScripts call is guarded for event-page browsers', function () {
  // importScripts only exists in a service worker. Unguarded, this throws on
  // load in Firefox and Safari and the background never starts.
  const source = fs.readFileSync(path.join(ROOT, RMPX.BACKGROUND_ENTRY), 'utf8');
  assert.match(source, /typeof importScripts === 'function'/);
});

/* -------------------------------------------------------------------------- *
 * Source hygiene
 * -------------------------------------------------------------------------- */

function walkJs(dir, files) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // dist/ is a copy of src/; scanning it would just double every check.
      if (['node_modules', '.git', 'dist'].includes(entry.name)) return;
      walkJs(full, files);
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  });
  return files;
}

test('all JavaScript parses', function () {
  const files = walkJs(ROOT, []);
  assert.ok(files.length >= 12, 'expected to find the whole source tree, found ' + files.length);
  files.forEach(function (file) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  });
});

test('no source file uses innerHTML with dynamic content', function () {
  const offenders = walkJs(path.join(ROOT, 'src'), []).filter(function (file) {
    const source = fs.readFileSync(file, 'utf8');
    return /\.innerHTML\s*=/.test(source) || /\.outerHTML\s*=/.test(source);
  }).map(function (file) { return path.relative(ROOT, file); });

  assert.deepStrictEqual(offenders, [], 'inject text with textContent, not innerHTML');
});
