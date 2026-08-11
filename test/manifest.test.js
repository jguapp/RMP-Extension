'use strict';

/**
 * Structural checks. Content scripts never execute under Node, so a typo in a
 * manifest path or a syntax error in the DOM layer would otherwise only show up
 * when loading the unpacked extension in a browser.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

test('manifest declares MV3', function () {
  assert.strictEqual(manifest.manifest_version, 3);
  assert.ok(manifest.name);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test('every declared icon exists', function () {
  Object.values(manifest.icons).forEach(function (file) {
    assert.ok(exists(file), 'missing icon: ' + file);
  });
  Object.values(manifest.action.default_icon).forEach(function (file) {
    assert.ok(exists(file), 'missing action icon: ' + file);
  });
});

test('the service worker exists', function () {
  assert.ok(exists(manifest.background.service_worker));
});

test('every content script file exists', function () {
  manifest.content_scripts.forEach(function (entry) {
    entry.js.forEach(function (file) {
      assert.ok(exists(file), 'missing content script: ' + file);
    });
    (entry.css || []).forEach(function (file) {
      assert.ok(exists(file), 'missing stylesheet: ' + file);
    });
  });
});

test('the popup and its assets exist', function () {
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

test('content scripts are listed in dependency order', function () {
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

test('the service worker imports every library it uses', function () {
  const source = fs.readFileSync(path.join(ROOT, manifest.background.service_worker), 'utf8');
  ['namespace.js', 'name-utils.js', 'matching.js', 'schools.js', 'cache.js', 'rmp-client.js']
    .forEach(function (file) {
      assert.ok(source.includes(file), 'service worker does not importScripts ' + file);
    });
});

test('host permissions cover ratemyprofessors and every injected origin', function () {
  const hosts = manifest.host_permissions;
  assert.ok(hosts.some(function (h) { return h.includes('ratemyprofessors.com'); }));
  manifest.content_scripts[0].matches.forEach(function (match) {
    assert.ok(hosts.includes(match), 'content script origin lacks host permission: ' + match);
  });
});

test('all JavaScript parses', function () {
  const files = [];
  const walk = function (dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') return;
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        files.push(full);
      }
    });
  };
  walk(ROOT);

  assert.ok(files.length >= 12, 'expected to find the whole source tree, found ' + files.length);
  files.forEach(function (file) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  });
});

test('no source file uses innerHTML with dynamic content', function () {
  const offenders = [];
  const walk = function (dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') return;
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        const source = fs.readFileSync(full, 'utf8');
        if (/\.innerHTML\s*=/.test(source) || /\.outerHTML\s*=/.test(source)) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    });
  };
  walk(path.join(ROOT, 'src'));

  assert.deepStrictEqual(offenders, [], 'inject text with textContent, not innerHTML');
});
