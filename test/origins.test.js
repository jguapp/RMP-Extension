'use strict';

const test = require('node:test');
const assert = require('node:assert');

require('../src/lib/namespace.js');
const origins = require('../src/lib/origins.js');

test('normalises the shapes chrome.permissions hands back', function () {
  assert.strictEqual(origins.normalize('https://a.cuny.edu/*'), 'https://a.cuny.edu');
  assert.strictEqual(origins.normalize('https://a.cuny.edu/'), 'https://a.cuny.edu');
  assert.strictEqual(origins.normalize('https://a.cuny.edu'), 'https://a.cuny.edu');
  assert.strictEqual(origins.normalize(undefined), '');
});

test('recognises origins the manifest already covers', function () {
  ['https://home.cunyfirst.cuny.edu', 'https://cuny.edu', 'https://bc.collegescheduler.com/*']
    .forEach(function (origin) {
      assert.ok(origins.isStaticallyCovered(origin), 'should be built in: ' + origin);
    });

  ['https://schedulebuilder.qc.example.com', 'https://notcuny.edu']
    .forEach(function (origin) {
      assert.ok(!origins.isStaticallyCovered(origin), 'should not be built in: ' + origin);
    });
});

test('a lookalike domain does not pass as CUNY', function () {
  // The pattern must anchor, or "cuny.edu.evil.com" would be treated as ours.
  assert.ok(!origins.isStaticallyCovered('https://cuny.edu.evil.com'));
  assert.ok(!origins.isStaticallyCovered('https://fakecuny.edu'));
  assert.ok(!origins.isApiHost('https://ratemyprofessors.com.evil.com'));
});

test('the ratings API is never a page to annotate', function () {
  // Regression: this origin is in host_permissions so the background can fetch
  // from it, and chrome.permissions.getAll() returns it alongside the origins
  // the user actually opted in to. Registering content scripts for it put
  // badges all over RMP's own "similar professors" list.
  ['https://www.ratemyprofessors.com', 'https://www.ratemyprofessors.com/*',
    'https://ratemyprofessors.com'].forEach(function (origin) {
    assert.ok(origins.isApiHost(origin), 'should be the API host: ' + origin);
    assert.ok(!origins.isOptInCandidate(origin),
      'must never be registered as an opt-in site: ' + origin);
  });
});

test('a campus on an unrecognised domain is a valid opt-in', function () {
  assert.ok(origins.isOptInCandidate('https://schedulebuilder.qc.edu'));
  assert.ok(origins.isOptInCandidate('http://localhost:8080'));
});

test('rejects anything that is not a plain web origin', function () {
  ['chrome://extensions', 'about:debugging', 'file:///c:/tmp', '', null,
    'https://example.com/some/path'].forEach(function (value) {
    assert.ok(!origins.isOptInCandidate(value), 'should be rejected: ' + value);
  });
});

test('built-in origins are not opt-in candidates either', function () {
  // They already have static content scripts; registering them again would
  // inject the whole bundle twice.
  assert.ok(!origins.isOptInCandidate('https://home.cunyfirst.cuny.edu'));
  assert.ok(!origins.isOptInCandidate('https://bc.collegescheduler.com'));
});
