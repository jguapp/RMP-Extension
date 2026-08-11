'use strict';

const test = require('node:test');
const assert = require('node:assert');

require('../src/lib/namespace.js');
const subjects = require('../src/lib/subjects.js');

test('pulls the subject code out of a course string', function () {
  assert.strictEqual(subjects.subjectFromText('ACC 3202 Intermediate Accounting'), 'ACC');
  assert.strictEqual(subjects.subjectFromText('CSCI-135'), 'CSCI');
  assert.strictEqual(subjects.subjectFromText('MATH2610'), 'MATH');
});

test('returns null when there is no course code', function () {
  assert.strictEqual(subjects.subjectFromText('Instructor: John Smith'), null);
  assert.strictEqual(subjects.subjectFromText(''), null);
  assert.strictEqual(subjects.subjectFromText(null), null);
});

test('maps subject codes to RMP department names', function () {
  assert.strictEqual(subjects.departmentForSubject('ACC'), 'Accounting');
  assert.strictEqual(subjects.departmentForSubject('psy'), 'Psychology');
  assert.strictEqual(subjects.departmentForSubject('ZZZ'), null);
});

test('goes straight from page text to a department hint', function () {
  assert.strictEqual(subjects.departmentFromText('ECO 1001 Micro'), 'Economics');
  assert.strictEqual(subjects.departmentFromText('No code here'), null);
});
