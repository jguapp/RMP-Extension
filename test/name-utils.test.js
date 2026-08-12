'use strict';

const test = require('node:test');
const assert = require('node:assert');

require('../src/lib/namespace.js');
const nameUtils = require('../src/lib/name-utils.js');

const { parseName, parseInstructorField, segmentInstructorField, looksLikePersonName } = nameUtils;

test('parses the "Last,First Middle" form CUNYfirst uses most', function () {
  const parsed = parseName('Smith,John A');
  assert.strictEqual(parsed.first, 'John');
  assert.strictEqual(parsed.middle, 'A');
  assert.strictEqual(parsed.last, 'Smith');
  assert.strictEqual(parsed.display, 'John Smith');
});

test('parses "Last, First" with a space after the comma', function () {
  const parsed = parseName('Smith, John');
  assert.strictEqual(parsed.display, 'John Smith');
});

test('parses the plain "First Last" form', function () {
  const parsed = parseName('John Smith');
  assert.strictEqual(parsed.first, 'John');
  assert.strictEqual(parsed.last, 'Smith');
});

test('normalises all-caps rosters to title case', function () {
  assert.strictEqual(parseName('SMITH, JOHN A.').display, 'John Smith');
});

test('strips honorifics and trailing credentials', function () {
  assert.strictEqual(parseName('Dr. John Smith').display, 'John Smith');
  assert.strictEqual(parseName('John Smith, Ph.D.').display, 'John Smith');
  assert.strictEqual(parseName('Prof. Jane Doe, M.D.').display, 'Jane Doe');
});

test('keeps generational suffixes out of the surname', function () {
  assert.strictEqual(parseName('Robert Downey Jr.').last, 'Downey');
});

test('preserves capitalisation inside Irish and Scottish surnames', function () {
  assert.strictEqual(parseName("O'Brien, Sean").last, "O'Brien");
  assert.strictEqual(parseName('MCDONALD, ANGUS').last, 'McDonald');
});

test('folds lowercase particles into the surname', function () {
  const parsed = parseName('Anna van der Berg');
  assert.strictEqual(parsed.first, 'Anna');
  assert.strictEqual(nameUtils.surnameTokens(parsed.last).join(' '), 'van der berg');
});

test('rejects placeholder instructors', function () {
  ['Staff', 'STAFF', 'TBA', 'To be Announced', 'Not Assigned', ''].forEach(function (value) {
    assert.strictEqual(parseName(value), null, 'expected null for ' + JSON.stringify(value));
  });
});

test('rejects a bare surname with no given name', function () {
  assert.strictEqual(parseName('Smith'), null);
});

test('rejects Title Case phrases that sit beside instructor names', function () {
  // These all parse cleanly as "First Last"; they just are not people. Each
  // appears in the same Schedule Builder card as the actual instructor.
  [
    'Baruch College',
    'Online Synchronous',
    'Online Courses',
    'Regular Academic Session',
    'Hunter College',
    'Newman Vertical Campus',
    'Class Details',
    'Schedule Results',
    // Instruction modes. Every word in these is fine on its own, which is why
    // they are held as whole phrases: "In Person" was being read as a person
    // named In Person on any card whose instructor was still "Staff".
    'In Person',
    'In-Person',
    'Face to Face',
  ].forEach(function (phrase) {
    assert.strictEqual(parseName(phrase), null, 'expected null for ' + JSON.stringify(phrase));
    assert.ok(!looksLikePersonName(phrase), 'should not look like a name: ' + phrase);
  });
});

test('the stopword guard does not eat real surnames', function () {
  // Words that are also plausible surnames must stay allowed.
  ['John Hall', 'Mary Church', 'Peter Camp', 'Ann Park', 'Sara Field', 'Amy Young']
    .forEach(function (name) {
      assert.ok(parseName(name), 'should still parse: ' + name);
    });
});

test('accepts the plain "First Last" names Schedule Builder cards use', function () {
  assert.strictEqual(parseName('Miriam Hansman').display, 'Miriam Hansman');
  assert.strictEqual(parseName('David McNutt').display, 'David McNutt');
  assert.strictEqual(parseName('David McNutt').last, 'McNutt');
});

test('flags initial-only given names and searches on the surname', function () {
  const parsed = parseName('Smith, J');
  assert.strictEqual(parsed.initialOnly, true);
  assert.strictEqual(parsed.query, 'Smith');
});

test('searches on the full name when a real given name is present', function () {
  const parsed = parseName('Smith, John');
  assert.strictEqual(parsed.initialOnly, false);
  assert.strictEqual(parsed.query, 'John Smith');
});

test('splits co-instructors on a semicolon', function () {
  const people = parseInstructorField('Smith,John; Doe,Jane');
  assert.deepStrictEqual(people.map(function (p) { return p.display; }), ['John Smith', 'Jane Doe']);
});

test('splits co-instructors on the word "and"', function () {
  const people = parseInstructorField('John Smith and Jane Doe');
  assert.deepStrictEqual(people.map(function (p) { return p.display; }), ['John Smith', 'Jane Doe']);
});

test('splits an even run of comma parts into Last/First pairs', function () {
  const people = parseInstructorField('Smith, John, Doe, Jane');
  assert.deepStrictEqual(people.map(function (p) { return p.display; }), ['John Smith', 'Jane Doe']);
});

test('does not mistake a credential clause for a second instructor', function () {
  const people = parseInstructorField('Smith, John, Ph.D.');
  assert.deepStrictEqual(people.map(function (p) { return p.display; }), ['John Smith']);
});

test('de-duplicates an instructor listed twice', function () {
  const people = parseInstructorField('Smith,John; Smith,John');
  assert.strictEqual(people.length, 1);
});

test('drops placeholders while keeping real co-instructors', function () {
  const people = parseInstructorField('Smith,John; Staff');
  assert.deepStrictEqual(people.map(function (p) { return p.display; }), ['John Smith']);
});

test('segment offsets index into the original, untrimmed string', function () {
  const raw = '  Smith,John;  Doe,Jane  ';
  const segments = segmentInstructorField(raw);
  assert.strictEqual(segments.length, 2);
  segments.forEach(function (segment) {
    assert.strictEqual(raw.slice(segment.start, segment.end), segment.text);
  });
  assert.strictEqual(segments[0].text, 'Smith,John');
  assert.strictEqual(segments[1].text, 'Doe,Jane');
});

test('segments stay in document order and never overlap', function () {
  const raw = 'Alpha, Ann and Beta, Bob; Gamma, Gil';
  const segments = segmentInstructorField(raw);
  assert.strictEqual(segments.length, 3);
  for (let i = 1; i < segments.length; i += 1) {
    assert.ok(segments[i].start >= segments[i - 1].end, 'segments must not overlap');
  }
});

test('name sniffing accepts people and rejects schedule noise', function () {
  assert.ok(looksLikePersonName('Smith, John'));
  assert.ok(looksLikePersonName('John Smith'));
  assert.ok(!looksLikePersonName('MW 9:00AM - 10:15AM'));
  assert.ok(!looksLikePersonName('Room 4-215'));
  assert.ok(!looksLikePersonName('Staff'));
  assert.ok(!looksLikePersonName('3 credits'));
});

test('recognises nicknames in both directions', function () {
  assert.ok(nameUtils.isNicknameEquivalent('Bob', 'Robert'));
  assert.ok(nameUtils.isNicknameEquivalent('Robert', 'Bob'));
  assert.ok(nameUtils.isNicknameEquivalent('Cathy', 'Katherine'));
  assert.ok(!nameUtils.isNicknameEquivalent('Robert', 'William'));
});

test('normalisation strips accents and punctuation', function () {
  assert.strictEqual(nameUtils.normalizeToken('Muñoz-Peña'), 'munozpena');
  assert.strictEqual(nameUtils.normalizeToken("O'Brien"), 'obrien');
});
