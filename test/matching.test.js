'use strict';

const test = require('node:test');
const assert = require('node:assert');

require('../src/lib/namespace.js');
const nameUtils = require('../src/lib/name-utils.js');
const matching = require('../src/lib/matching.js');

function teacher(firstName, lastName, extra) {
  return Object.assign(
    { id: 'node-' + firstName + lastName, legacyId: firstName + lastName, firstName, lastName, numRatings: 10 },
    extra || {}
  );
}

test('accepts an exact first and last name match', function () {
  const parsed = nameUtils.parseName('Smith, John');
  const result = matching.pickBestMatch(parsed, [teacher('John', 'Smith')]);
  assert.ok(result.match);
  assert.strictEqual(result.confidence, matching.CONFIDENCE.HIGH);
  assert.strictEqual(result.ambiguous, false);
});

test('rejects a different person with the same surname', function () {
  const parsed = nameUtils.parseName('Smith, John');
  const result = matching.pickBestMatch(parsed, [teacher('Jane', 'Smith')]);
  assert.strictEqual(result.match, null);
});

test('rejects a matching given name with a different surname', function () {
  const parsed = nameUtils.parseName('Smith, John');
  const result = matching.pickBestMatch(parsed, [teacher('John', 'Baker')]);
  assert.strictEqual(result.match, null);
});

test('matches a nickname to the formal name', function () {
  const parsed = nameUtils.parseName('Smith, Bob');
  const result = matching.pickBestMatch(parsed, [teacher('Robert', 'Smith')]);
  assert.ok(result.match);
  assert.strictEqual(result.match.firstName, 'Robert');
});

test('matches a hyphenated surname against one of its halves', function () {
  const parsed = nameUtils.parseName('Smith-Jones, Alice');
  const result = matching.pickBestMatch(parsed, [teacher('Alice', 'Smith')]);
  assert.ok(result.match);
});

test('accepts an initial when the roster only gave one', function () {
  const parsed = nameUtils.parseName('Smith, J');
  const result = matching.pickBestMatch(parsed, [teacher('John', 'Smith')]);
  assert.ok(result.match);
  assert.strictEqual(result.confidence, matching.CONFIDENCE.LOW);
});

test('picks the better-rated profile among equally good name matches', function () {
  const parsed = nameUtils.parseName('Smith, John');
  const result = matching.pickBestMatch(parsed, [
    teacher('John', 'Smith', { legacyId: 'quiet', numRatings: 1 }),
    teacher('John', 'Smith', { legacyId: 'busy', numRatings: 90 }),
  ]);
  assert.strictEqual(result.match.legacyId, 'busy');
});

test('flags two distinct professors sharing a name as ambiguous', function () {
  const parsed = nameUtils.parseName('Smith, John');
  const result = matching.pickBestMatch(parsed, [
    teacher('John', 'Smith', { legacyId: 'a', numRatings: 20 }),
    teacher('John', 'Smith', { legacyId: 'b', numRatings: 18 }),
  ]);
  assert.ok(result.match);
  assert.strictEqual(result.ambiguous, true);
  assert.strictEqual(result.confidence, matching.CONFIDENCE.LOW);
});

test('a matching department breaks a tie without rescuing a bad name', function () {
  const parsed = nameUtils.parseName('Smith, John');
  const result = matching.pickBestMatch(
    parsed,
    [
      teacher('John', 'Smith', { legacyId: 'history', department: 'History', numRatings: 20 }),
      teacher('John', 'Smith', { legacyId: 'math', department: 'Mathematics', numRatings: 20 }),
    ],
    { subjectHint: 'Mathematics' }
  );
  assert.strictEqual(result.match.legacyId, 'math');

  const wrongName = matching.pickBestMatch(
    parsed,
    [teacher('Wanda', 'Baker', { department: 'Mathematics' })],
    { subjectHint: 'Mathematics' }
  );
  assert.strictEqual(wrongName.match, null);
});

test('returns no match for an empty candidate list', function () {
  const parsed = nameUtils.parseName('Smith, John');
  const result = matching.pickBestMatch(parsed, []);
  assert.strictEqual(result.match, null);
  assert.strictEqual(result.considered, 0);
});

test('survives malformed candidates from the API', function () {
  const parsed = nameUtils.parseName('Smith, John');
  const result = matching.pickBestMatch(parsed, [null, {}, { firstName: 'John' }, teacher('John', 'Smith')]);
  assert.ok(result.match);
  assert.strictEqual(result.match.lastName, 'Smith');
});

test('a rating-count bonus never outweighs a name mismatch', function () {
  const parsed = nameUtils.parseName('Smith, John');
  const popular = teacher('Jane', 'Smith', { numRatings: 5000 });
  assert.strictEqual(matching.scoreCandidate(parsed, popular), null);
});
