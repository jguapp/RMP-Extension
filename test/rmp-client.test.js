'use strict';

const test = require('node:test');
const assert = require('node:assert');

require('../src/lib/namespace.js');
const client = require('../src/lib/rmp-client.js');

test('turns RMP sentinel values into nulls', function () {
  const shaped = client._shapeTeacher({
    id: 'abc',
    legacyId: 12345,
    firstName: 'John',
    lastName: 'Smith',
    department: 'Mathematics',
    avgRating: 0,
    numRatings: 0,
    avgDifficulty: 0,
    wouldTakeAgainPercent: -1,
  });

  assert.strictEqual(shaped.avgRating, null, 'no ratings means no average');
  assert.strictEqual(shaped.avgDifficulty, null);
  assert.strictEqual(shaped.wouldTakeAgainPercent, null, '-1 is RMP for "unknown"');
  assert.strictEqual(shaped.legacyId, '12345', 'legacyId is normalised to a string');
});

test('keeps real values intact', function () {
  const shaped = client._shapeTeacher({
    id: 'abc',
    legacyId: '9',
    firstName: 'Jane',
    lastName: 'Doe',
    avgRating: 4.6,
    numRatings: 42,
    avgDifficulty: 2.8,
    wouldTakeAgainPercent: 91.5,
    school: { id: 's1', name: 'Baruch College' },
  });

  assert.strictEqual(shaped.avgRating, 4.6);
  assert.strictEqual(shaped.numRatings, 42);
  assert.strictEqual(shaped.avgDifficulty, 2.8);
  assert.strictEqual(shaped.wouldTakeAgainPercent, 91.5);
  assert.strictEqual(shaped.school.name, 'Baruch College');
});

test('tolerates a null node', function () {
  assert.strictEqual(client._shapeTeacher(null), null);
});

test('sums a distribution when the total field is missing', function () {
  const shaped = client._shapeDistribution({ r1: 1, r2: 2, r3: 3, r4: 4, r5: 5 });
  assert.strictEqual(shaped.total, 15);
  assert.strictEqual(shaped.counts[5], 5);
});

test('prefers the reported total when present', function () {
  const shaped = client._shapeDistribution({ r1: 0, r2: 0, r3: 0, r4: 0, r5: 7, total: 7 });
  assert.strictEqual(shaped.total, 7);
});

test('an all-zero distribution is treated as absent', function () {
  assert.strictEqual(client._shapeDistribution({ r1: 0, r2: 0, r3: 0, r4: 0, r5: 0, total: 0 }), null);
  assert.strictEqual(client._shapeDistribution(null), null);
});

test('tags are sorted by frequency and capped', function () {
  const tags = client._shapeTags([
    { tagName: 'Tough grader', tagCount: 3 },
    { tagName: 'Caring', tagCount: 11 },
    { tagName: 'Lecture heavy', tagCount: 7 },
    { tagName: null, tagCount: 99 },
  ]);

  assert.deepStrictEqual(tags.map(function (t) { return t.name; }), [
    'Caring',
    'Lecture heavy',
    'Tough grader',
  ]);
});

test('tag shaping tolerates a non-array', function () {
  assert.deepStrictEqual(client._shapeTags(undefined), []);
});

/** Reviews carry their tags as one '--'-separated string each. */
function ratingEdges(list) {
  return { edges: list.map(function (tags) { return { node: { ratingTags: tags } }; }) };
}

test('tallies the tags attached to individual reviews', function () {
  const tags = client._aggregateRatingTags(ratingEdges([
    'Tough grader--Test heavy--Participation matters',
    'Tough grader--Test heavy',
    'Tough grader',
    'Caring',
  ]));

  assert.deepStrictEqual(tags, [
    { name: 'Tough grader', count: 3 },
    { name: 'Test heavy', count: 2 },
    { name: 'Caring', count: 1 },
    { name: 'Participation matters', count: 1 },
  ]);
});

test('one tag spelled several ways is a single tag', function () {
  // All four spellings occur in live RMP data.
  const tags = client._aggregateRatingTags(ratingEdges([
    'Tough grader',
    'Tough Grader',
    'TOUGH GRADER',
    'Tough grader',
    'Amazing lectures ',
    'Amazing  lectures',
  ]));

  assert.deepStrictEqual(tags, [
    { name: 'Tough grader', count: 4 },
    { name: 'Amazing lectures', count: 2 },
  ]);
});

test('reviews without tags contribute nothing', function () {
  assert.deepStrictEqual(client._aggregateRatingTags(ratingEdges(['', null, '--', ' '])), []);
  assert.deepStrictEqual(client._aggregateRatingTags(null), []);
  assert.deepStrictEqual(client._aggregateRatingTags({ edges: [null, {}] }), []);
});

test('only the most common tags survive', function () {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  // Tag "a" appears 8 times, "b" 7 times, and so on down to "h" once.
  const reviews = many.map(function (_, i) { return many.slice(0, many.length - i).join('--'); });
  const tags = client._aggregateRatingTags(ratingEdges(reviews));

  assert.strictEqual(tags.length, client.TAG_LIMIT);
  assert.deepStrictEqual(tags.map(function (t) { return t.name; }), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('the endpoint is the real RMP GraphQL URL over HTTPS', function () {
  assert.strictEqual(client.ENDPOINT, 'https://www.ratemyprofessors.com/graphql');
});
