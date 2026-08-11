'use strict';

const test = require('node:test');
const assert = require('node:assert');

require('../src/lib/namespace.js');
const schools = require('../src/lib/schools.js');

test('every campus entry is well formed and uniquely keyed', function () {
  const keys = new Set();
  schools.SCHOOLS.forEach(function (school) {
    assert.ok(school.key, 'missing key');
    assert.ok(!keys.has(school.key), 'duplicate key: ' + school.key);
    keys.add(school.key);
    assert.ok(school.name, school.key + ' is missing a name');
    assert.ok(school.searchText, school.key + ' is missing searchText');
    assert.ok(Array.isArray(school.aliases) && school.aliases.length, school.key + ' has no aliases');
    school.aliases.forEach(function (alias) {
      assert.strictEqual(alias, alias.toLowerCase(), 'aliases must be lowercase: ' + alias);
      assert.ok(alias.length >= 2, 'alias too short: ' + alias);
    });
  });
});

test('the default campus exists', function () {
  assert.ok(schools.getSchool('baruch'));
  assert.strictEqual(schools.getSchool('baruch').name, 'Baruch College');
});

test('detects a campus from page text', function () {
  assert.strictEqual(schools.detectSchoolFromText('Baruch College Schedule Builder').key, 'baruch');
  assert.strictEqual(schools.detectSchoolFromText('Welcome to Hunter College').key, 'hunter');
  assert.strictEqual(schools.detectSchoolFromText('QUEENS COLLEGE class search').key, 'queens');
});

test('prefers the longest matching alias', function () {
  // "college of staten island" must beat a bare "college" style partial.
  assert.strictEqual(schools.detectSchoolFromText('College of Staten Island').key, 'csi');
  assert.strictEqual(
    schools.detectSchoolFromText('John Jay College of Criminal Justice').key,
    'johnjay'
  );
});

test('requires word boundaries so aliases do not fire inside other words', function () {
  assert.strictEqual(schools.detectSchoolFromText('rehunterized nonsense'), null);
  assert.strictEqual(schools.detectSchoolFromText('unrelated page'), null);
});

test('detects a campus from a CUNYfirst institution code', function () {
  assert.strictEqual(schools.detectSchoolFromCode('BAR01'), 'baruch');
  assert.strictEqual(schools.detectSchoolFromCode('HTR01'), 'hunter');
  assert.strictEqual(schools.detectSchoolFromCode(''), null);
});

test('listSchools returns a copy, not the live array', function () {
  const list = schools.listSchools();
  list.length = 0;
  assert.ok(schools.listSchools().length > 0);
});
