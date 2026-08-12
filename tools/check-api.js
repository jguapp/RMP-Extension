#!/usr/bin/env node
/**
 * Smoke test against the live Rate My Professors API.
 *
 *   node tools/check-api.js
 *
 * Deliberately NOT part of `npm test`. The unit suite is offline and
 * deterministic, and it should stay that way -- this reaches a third party
 * that can be slow, rate-limited or simply down, none of which should fail a
 * pull request.
 *
 * It exists because of a failure the offline tests cannot see, and did not.
 * RMP quietly began returning an empty list from teacherRatingTags, so the
 * hover card advertised "the professor's most common tags" and rendered none.
 * Nothing threw. No test failed. The only symptom was a feature that silently
 * stopped existing, and it went unnoticed until somebody looked.
 *
 * So this asserts the *shape* of what comes back, not just that a request
 * succeeded, and it runs the real client rather than a parallel copy of it --
 * a regression in rmp-client.js fails here too.
 */
'use strict';

require('../src/lib/namespace.js');
const client = require('../src/lib/rmp-client.js');

let failures = 0;

function pass(what, detail) {
  console.log('  ok   ' + what + (detail ? '  (' + detail + ')' : ''));
}

function fail(what, why) {
  failures += 1;
  console.log('  FAIL ' + what + '\n       ' + why);
}

function check(what, condition, why, detail) {
  if (condition) pass(what, detail);
  else fail(what, why);
}

async function main() {
  console.log('Rate My Professors API smoke test\n');

  /* -- schools ----------------------------------------------------------- */

  let schools = [];
  try {
    schools = await client.searchSchools('Baruch College');
  } catch (err) {
    fail('school search reachable', String((err && err.message) || err));
  }

  check('school search returns results', schools.length > 0,
    'searchSchools returned nothing; campus resolution would fail for everyone',
    schools.length + ' hits');

  const school = schools[0];
  if (school) {
    check('a school carries the ids the worker caches',
      Boolean(school.id) && Boolean(school.legacyId),
      'a school node is missing id or legacyId: ' + JSON.stringify(school));
  }

  /* -- teacher search ---------------------------------------------------- */

  let candidates = [];
  try {
    candidates = await client.searchTeachers('Smith', null, 20);
  } catch (err) {
    fail('teacher search reachable', String((err && err.message) || err));
  }

  check('teacher search returns results', candidates.length > 0,
    'searchTeachers returned nothing; every badge would read n/a',
    candidates.length + ' hits');

  // The most-reviewed hit is the safest subject for the detail checks below.
  const subject = candidates.reduce(function (best, one) {
    return !best || one.numRatings > best.numRatings ? one : best;
  }, null);

  if (subject) {
    check('a shaped teacher has the fields the badge needs',
      Boolean(subject.id) && typeof subject.numRatings === 'number' &&
        typeof subject.firstName === 'string' && typeof subject.lastName === 'string',
      'shapeTeacher produced an unusable record: ' + JSON.stringify(subject));

    check('a well-reviewed professor reports an average rating',
      subject.numRatings === 0 || typeof subject.avgRating === 'number',
      'numRatings is ' + subject.numRatings + ' but avgRating is ' + subject.avgRating,
      subject.numRatings + ' ratings');
  }

  /* -- profile detail ---------------------------------------------------- */

  if (!subject || subject.numRatings < 20) {
    fail('found a professor with enough ratings to test detail against',
      'best candidate had ' + (subject ? subject.numRatings : 0) +
      ' ratings; cannot tell a real regression from a thin profile');
  } else {
    let detail = null;
    try {
      detail = await client.getTeacherDetail(subject.id);
    } catch (err) {
      fail('profile detail reachable', String((err && err.message) || err));
    }

    if (detail) {
      const who = detail.firstName + ' ' + detail.lastName;

      check('the score histogram still comes back',
        Boolean(detail.distribution) && detail.distribution.total > 0,
        'ratingsDistribution is empty for ' + who + ', who has ' +
          detail.numRatings + ' ratings — the hover card would lose its histogram',
        who);

      // The one that actually broke.
      check('tags can still be tallied from the ratings',
        Array.isArray(detail.tags) && detail.tags.length > 0,
        'no tags for ' + who + ' despite ' + detail.numRatings + ' ratings. ' +
          'Either ratingTags stopped coming back on individual ratings, or its ' +
          'format changed and aggregateRatingTags no longer parses it.',
        detail.tags.length ? detail.tags.slice(0, 3).map(function (t) {
          return t.name + ' x' + t.count;
        }).join(', ') : '');

      check('tags are ranked most-mentioned first',
        detail.tags.length < 2 || detail.tags[0].count >= detail.tags[1].count,
        'tag ordering is wrong: ' + JSON.stringify(detail.tags.slice(0, 2)));
    }
  }

  /* ---------------------------------------------------------------------- */

  console.log('');
  if (failures) {
    console.log(failures + ' check(s) failed — the API this extension depends on has moved.');
    process.exit(1);
  }
  console.log('All checks passed. The API still looks the way rmp-client.js expects.');
}

main().catch(function (err) {
  console.error('\nsmoke test crashed: ' + ((err && err.stack) || err));
  process.exit(1);
});
