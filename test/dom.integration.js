#!/usr/bin/env node
'use strict';

/**
 * End-to-end check of the DOM layer in a real browser.
 *
 * The unit tests cover parsing and matching, but the scanner, the annotator and
 * the hover card only ever run inside a page. This drives them against a
 * fixture that mimics both CUNYfirst layouts, with the extension messaging API
 * stubbed so no network access is involved.
 *
 *   npm run test:dom            # assertions only
 *   npm run test:dom -- --shots # also writes screenshots to test/screenshots
 *
 * Requires Playwright. It is intentionally not part of `npm test` so the unit
 * suite stays dependency-free.
 */

const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error('Playwright is not installed. Run: npm install -D playwright');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'schedule-builder.html');
const SHOTS_DIR = path.join(__dirname, 'screenshots');
const WANT_SHOTS = process.argv.includes('--shots');

const CONTENT_SCRIPTS = [
  'src/lib/namespace.js',
  'src/lib/name-utils.js',
  'src/lib/matching.js',
  'src/lib/schools.js',
  'src/lib/subjects.js',
  'src/content/scanner.js',
  'src/content/badge.js',
  'src/content/hovercard.js',
  'src/content/content.js',
];

/**
 * Canned RMP data, keyed by the parsed-name key the content script sends.
 * Deliberately covers a match, a low-rated professor, an unrated profile and
 * a name with no RMP presence at all.
 */
const FAKE_DB = {
  'john|smith': {
    status: 'match',
    professor: {
      id: 'node-1', legacyId: '111', firstName: 'John', lastName: 'Smith',
      department: 'Accounting', numRatings: 84, avgRating: 4.4,
      avgDifficulty: 2.9, wouldTakeAgainPercent: 88,
      school: { id: 's1', name: 'Baruch College' },
    },
    confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/111',
  },
  'maria|garcia': {
    status: 'match',
    professor: {
      id: 'node-2', legacyId: '222', firstName: 'Maria', lastName: 'Garcia',
      department: 'Mathematics', numRatings: 31, avgRating: 2.1,
      avgDifficulty: 4.5, wouldTakeAgainPercent: 22,
      school: { id: 's1', name: 'Baruch College' },
    },
    confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/222',
  },
  'jane|doe': {
    status: 'match',
    professor: {
      id: 'node-3', legacyId: '333', firstName: 'Jane', lastName: 'Doe',
      department: 'English', numRatings: 12, avgRating: 3.5,
      avgDifficulty: 3.1, wouldTakeAgainPercent: 60,
      school: { id: 's1', name: 'Baruch College' },
    },
    confidence: 'medium', ambiguous: true,
    url: 'https://www.ratemyprofessors.com/professor/333',
  },
  'rick|roe': {
    status: 'match',
    professor: {
      id: 'node-4', legacyId: '444', firstName: 'Rick', lastName: 'Roe',
      department: 'English', numRatings: 0, avgRating: null,
      avgDifficulty: null, wouldTakeAgainPercent: null,
      school: { id: 's1', name: 'Baruch College' },
    },
    confidence: 'medium', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/444',
  },
  'kenji|nakamura': {
    status: 'nomatch',
    searchUrl: 'https://www.ratemyprofessors.com/search/professors?q=Kenji%20Nakamura',
  },
  'adaeze|okonkwo': {
    status: 'match',
    professor: {
      id: 'node-6', legacyId: '666', firstName: 'Adaeze', lastName: 'Okonkwo',
      department: 'History', numRatings: 47, avgRating: 4.9,
      avgDifficulty: 2.2, wouldTakeAgainPercent: 97,
      school: { id: 's1', name: 'Baruch College' },
    },
    confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/666',
  },
  'miriam|hansman': {
    status: 'match',
    professor: {
      id: 'node-8', legacyId: '888', firstName: 'Miriam', lastName: 'Hansman',
      department: 'Computer Information Systems', numRatings: 23, avgRating: 4.1,
      avgDifficulty: 3.0, wouldTakeAgainPercent: 81,
      school: { id: 's1', name: 'Baruch College' },
    },
    confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/888',
  },
  'david|mcnutt': {
    status: 'match',
    professor: {
      id: 'node-9', legacyId: '999', firstName: 'David', lastName: 'McNutt',
      department: 'Management', numRatings: 15, avgRating: 3.6,
      avgDifficulty: 3.3, wouldTakeAgainPercent: 66,
      school: { id: 's1', name: 'Baruch College' },
    },
    confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/999',
  },
  'robert|alvarez': {
    status: 'match',
    professor: {
      id: 'node-7', legacyId: '777', firstName: 'Robert', lastName: 'Alvarez',
      department: 'Spanish', numRatings: 19, avgRating: 3.2,
      avgDifficulty: 3.4, wouldTakeAgainPercent: 55,
      school: { id: 's1', name: 'Baruch College' },
    },
    confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/777',
  },
};

const FAKE_DETAIL = {
  'node-1': { r1: 3, r2: 4, r3: 8, r4: 24, r5: 45, tags: ['Caring', 'Clear grading criteria', 'Inspirational'] },
  'node-2': { r1: 14, r2: 9, r3: 5, r4: 2, r5: 1, tags: ['Tough grader', 'Lots of homework'] },
  'node-3': { r1: 1, r2: 2, r3: 3, r4: 4, r5: 2, tags: ['Participation matters'] },
  'node-6': { r1: 0, r2: 1, r3: 2, r4: 9, r5: 35, tags: ['Amazing lectures', 'Respected', 'Caring'] },
  'node-7': { r1: 2, r2: 3, r3: 6, r4: 5, r5: 3, tags: ['Group projects'] },
};

/** Injected before any extension code so window.chrome exists on first use. */
function buildStub(db, detail) {
  return `
    (function () {
      const DB = ${JSON.stringify(db)};
      const DETAIL = ${JSON.stringify(detail)};
      window.__rmpxCalls = [];

      window.chrome = {
        runtime: {
          lastError: undefined,
          sendMessage: function (message, callback) {
            window.__rmpxCalls.push(message);
            const respond = function (value) { setTimeout(function () { callback(value); }, 5); };

            if (message.type === 'rmpx:get-settings') {
              return respond({ ok: true, settings: {
                enabled: true, hoverCards: true, schoolMode: 'auto',
                manualSchoolKey: 'baruch', showDifficulty: true,
                showWouldTakeAgain: true, minRatingsForBadge: 1,
              } });
            }

            if (message.type === 'rmpx:lookup') {
              const key = message.payload.name.key;
              const hit = DB[key];
              if (!hit) return respond({ ok: true, status: 'nomatch', searchUrl: 'https://www.ratemyprofessors.com/search/professors' });
              return respond(Object.assign({ ok: true }, hit));
            }

            if (message.type === 'rmpx:detail') {
              const raw = DETAIL[message.payload.nodeId];
              if (!raw) return respond({ ok: true, status: 'nomatch' });
              const counts = { 1: raw.r1, 2: raw.r2, 3: raw.r3, 4: raw.r4, 5: raw.r5 };
              const total = raw.r1 + raw.r2 + raw.r3 + raw.r4 + raw.r5;
              let base = null;
              Object.keys(DB).forEach(function (k) {
                if (DB[k].professor && DB[k].professor.id === message.payload.nodeId) base = DB[k].professor;
              });
              return respond({ ok: true, status: 'ok', professor: Object.assign({}, base, {
                distribution: { counts: counts, total: total },
                tags: raw.tags.map(function (name, i) { return { name: name, count: 10 - i }; }),
              }) });
            }

            return respond({ ok: false, error: 'unknown message' });
          },
        },
        storage: { onChanged: { addListener: function () {} } },
      };
    })();
  `;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

  const pageErrors = [];
  page.on('pageerror', function (err) { pageErrors.push(String(err)); });
  page.on('console', function (msg) {
    if (msg.type() === 'error') pageErrors.push('console: ' + msg.text());
  });

  await page.addInitScript(buildStub(FAKE_DB, FAKE_DETAIL));
  await page.goto('file://' + FIXTURE);

  await page.addStyleTag({ path: path.join(ROOT, 'src/content/styles.css') });
  for (const file of CONTENT_SCRIPTS) {
    await page.addScriptTag({ path: path.join(ROOT, file) });
  }

  await page.waitForSelector('.rmpx-badge[data-rmpx-state="match"]', { timeout: 5000 });
  await page.waitForTimeout(400);

  const checks = [];
  const check = function (name, fn) {
    try {
      fn();
      checks.push({ name: name, ok: true });
    } catch (err) {
      checks.push({ name: name, ok: false, error: err.message });
    }
  };

  /* --------------------------------------------------------------------- */

  const summary = await page.evaluate(function () {
    const anchors = Array.from(document.querySelectorAll('a.rmpx-name'));
    return {
      anchors: anchors.map(function (a) {
        const badge = a.nextElementSibling;
        return {
          text: a.textContent,
          href: a.getAttribute('href'),
          state: a.getAttribute('data-rmpx-state'),
          badgeText: badge ? badge.textContent : null,
          badgeState: badge ? badge.getAttribute('data-rmpx-state') : null,
          badgeTone: badge ? badge.getAttribute('data-rmpx-tone') : null,
        };
      }),
      // Cell text with our injected badges stripped out: this is what the
      // student still reads on the page.
      instructorCellText: (function () {
        const rows = Array.from(document.querySelectorAll('#results-grid tbody tr'));
        return rows.map(function (row) {
          const clone = row.children[5].cloneNode(true);
          clone.querySelectorAll('[data-rmpx="badge"]').forEach(function (n) { n.remove(); });
          return clone.textContent.trim();
        });
      })(),
      staffTouched: document.querySelectorAll('#results-grid tbody tr:nth-child(3) a.rmpx-name').length,
      // A card whose instructor is "Staff" must come back completely untouched.
      unassignedCard: Array.from(document.querySelectorAll('#mth2610 a.rmpx-name'))
        .map(function (a) { return a.textContent.trim(); }),
      // Any annotated text inside the detail cards that is not an instructor.
      cardNoise: Array.from(document.querySelectorAll('.class-details a.rmpx-name'))
        .filter(function (a) {
          return ['Miriam Hansman', 'David McNutt'].indexOf(a.textContent.trim()) === -1;
        }).length,
      schoolDetected: (window.__rmpxCalls.find(function (c) { return c.type === 'rmpx:lookup'; }) || {}).payload,
      subjectHints: window.__rmpxCalls
        .filter(function (c) { return c.type === 'rmpx:lookup'; })
        .map(function (c) { return [c.payload.name.display, c.payload.subjectHint]; }),
    };
  });

  check('no uncaught page errors', function () {
    assert.deepStrictEqual(pageErrors, []);
  });

  check('finds every real instructor and skips Staff', function () {
    const names = summary.anchors.map(function (a) { return a.text; }).sort();
    assert.deepStrictEqual(names, [
      'David McNutt',
      'Doe,Jane',
      'Dr. Robert Alvarez, Ph.D.',
      'Garcia,Maria',
      'Miriam Hansman',
      'Nakamura,Kenji',
      'Okonkwo, Adaeze',
      'Roe,Rick',
      'Smith,John A',
    ]);
  });

  check('finds a name beside an icon whose tooltip is the only marker', function () {
    const hansman = summary.anchors.find(function (a) { return a.text === 'Miriam Hansman'; });
    assert.ok(hansman, 'Schedule Builder card instructor was not found');
    assert.strictEqual(hansman.href, 'https://www.ratemyprofessors.com/professor/888');
    assert.strictEqual(hansman.badgeText, '4.123ratings');
  });

  check('does not mistake card labels for professors', function () {
    // "Baruch College", "Online Synchronous", "Online Courses" and
    // "4.0/4.0 Progress Units" all sit in the same card as the instructor.
    assert.strictEqual(summary.cardNoise, 0,
      'annotated ' + summary.cardNoise + ' non-name phrases in the details card');
  });

  check('does not annotate the Staff row', function () {
    assert.strictEqual(summary.staffTouched, 0);
  });

  check('leaves a section with no assigned professor alone', function () {
    // Regression: "Staff" gave the icon-marker strategy no name, so it searched
    // the rest of the card and linked "In Person" -- and would have linked
    // "Ingersoll Hall" too, since a building can read exactly like a surname.
    assert.deepStrictEqual(summary.unassignedCard, []);
  });

  check('preserves the original cell text verbatim', function () {
    assert.deepStrictEqual(summary.instructorCellText, [
      'Smith,John A',
      'Garcia,Maria',
      'Staff',
      'Doe,Jane; Roe,Rick',
      'Nakamura,Kenji',
    ]);
  });

  check('splits a co-taught cell into two separate links', function () {
    const coTaught = summary.anchors.filter(function (a) {
      return a.text === 'Doe,Jane' || a.text === 'Roe,Rick';
    });
    assert.strictEqual(coTaught.length, 2);
    assert.strictEqual(coTaught[0].href, 'https://www.ratemyprofessors.com/professor/333');
    assert.strictEqual(coTaught[1].href, 'https://www.ratemyprofessors.com/professor/444');
  });

  check('links each name to its RMP profile', function () {
    const smith = summary.anchors.find(function (a) { return a.text === 'Smith,John A'; });
    assert.strictEqual(smith.href, 'https://www.ratemyprofessors.com/professor/111');
    assert.strictEqual(smith.state, 'match');
  });

  check('spells out the rating count on the badge', function () {
    const smith = summary.anchors.find(function (a) { return a.text === 'Smith,John A'; });
    // The count is labelled so "84" cannot be read as a second score.
    assert.strictEqual(smith.badgeText, '4.484ratings');
    assert.strictEqual(smith.badgeTone, 'great');
  });

  check('tones a poor rating differently from a good one', function () {
    const garcia = summary.anchors.find(function (a) { return a.text === 'Garcia,Maria'; });
    assert.strictEqual(garcia.badgeTone, 'poor');
    const doe = summary.anchors.find(function (a) { return a.text === 'Doe,Jane'; });
    assert.strictEqual(doe.badgeTone, 'ok');
  });

  check('falls back to a search link when there is no profile', function () {
    const nakamura = summary.anchors.find(function (a) { return a.text === 'Nakamura,Kenji'; });
    assert.strictEqual(nakamura.badgeState, 'nomatch');
    assert.match(nakamura.href, /\/search\/professors/);
  });

  check('reports a profile that exists but has no ratings', function () {
    const roe = summary.anchors.find(function (a) { return a.text === 'Roe,Rick'; });
    assert.strictEqual(roe.badgeText, 'no ratings');
  });

  check('handles titles and credentials in explicit markup', function () {
    const alvarez = summary.anchors.find(function (a) {
      return a.text === 'Dr. Robert Alvarez, Ph.D.';
    });
    assert.strictEqual(alvarez.href, 'https://www.ratemyprofessors.com/professor/777');
  });

  check('detects the campus from the page', function () {
    assert.strictEqual(summary.schoolDetected.schoolKey, 'baruch');
  });

  check('passes a department hint drawn from the course code', function () {
    const hints = Object.fromEntries(summary.subjectHints);
    assert.strictEqual(hints['John Smith'], 'Accounting');
    assert.strictEqual(hints['Maria Garcia'], 'Mathematics');
  });

  /* ---- hover card ------------------------------------------------------ */

  await page.hover('a.rmpx-name[data-rmpx-person="john|smith"]');
  await page.waitForSelector('.rmpx-card:not([hidden])', { timeout: 4000 });
  await page.waitForSelector('.rmpx-card__histogram', { timeout: 4000 });

  const card = await page.evaluate(function () {
    const node = document.querySelector('.rmpx-card');
    const slices = Array.from(node.querySelectorAll('.rmpx-card__sentiment-slice'));
    const rows = Array.from(node.querySelectorAll('.rmpx-card__hist-row'));
    const rect = node.getBoundingClientRect();
    return {
      name: node.querySelector('.rmpx-card__name').textContent,
      meta: node.querySelector('.rmpx-card__meta').textContent,
      score: node.querySelector('.rmpx-card__score-value').textContent,
      stats: Array.from(node.querySelectorAll('.rmpx-card__stat')).map(function (s) {
        return s.textContent;
      }),
      legend: Array.from(node.querySelectorAll('.rmpx-card__legend-text')).map(function (l) {
        return l.textContent;
      }),
      buckets: slices.map(function (s) { return s.getAttribute('data-rmpx-bucket'); }),
      histogram: rows.map(function (r) {
        return [
          r.querySelector('.rmpx-card__hist-label').textContent,
          r.querySelector('.rmpx-card__hist-count').textContent,
        ];
      }),
      tags: Array.from(node.querySelectorAll('.rmpx-card__tag')).map(function (t) {
        return t.textContent;
      }),
      link: node.querySelector('.rmpx-card__link').getAttribute('href'),
      inViewport: rect.left >= 0 && rect.top >= 0 &&
        rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
    };
  });

  check('hover card shows the professor identity', function () {
    assert.strictEqual(card.name, 'John Smith');
    assert.strictEqual(card.meta, 'Accounting · Baruch College');
    assert.strictEqual(card.score, '4.4');
  });

  check('hover card shows ratings, retake rate and difficulty', function () {
    assert.deepStrictEqual(card.stats, ['84ratings', '88%would retake', '2.9/5difficulty']);
  });

  check('hover card renders the good/bad/awesome breakdown', function () {
    assert.deepStrictEqual(card.buckets, ['awesome', 'good', 'bad']);
    // 69 of 84 are 4- or 5-star, 8 are 3-star, 7 are 1- or 2-star.
    assert.deepStrictEqual(card.legend, ['Awesome 82.1%', 'Good 9.5%', 'Bad 8.3%']);
  });

  check('hover card renders the full 5-to-1 histogram', function () {
    assert.deepStrictEqual(card.histogram, [
      ['Awesome', '45'],
      ['Great', '24'],
      ['Good', '8'],
      ['OK', '4'],
      ['Awful', '3'],
    ]);
  });

  check('hover card shows tags and a link to the reviews', function () {
    assert.deepStrictEqual(card.tags, ['Caring', 'Clear grading criteria', 'Inspirational']);
    assert.strictEqual(card.link, 'https://www.ratemyprofessors.com/professor/111');
  });

  check('hover card stays inside the viewport', function () {
    assert.ok(card.inViewport, 'card overflowed the viewport');
  });

  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS_DIR, 'hover-card.png') });
  }

  /* ---- dismissal + idempotency ----------------------------------------- */

  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const hidden = await page.evaluate(function () {
    return document.querySelector('.rmpx-card').hidden;
  });
  check('Escape dismisses the hover card', function () {
    assert.strictEqual(hidden, true);
  });

  // Re-running the scan must not double-annotate anything.
  const beforeRescan = await page.evaluate(function () {
    return document.querySelectorAll('a.rmpx-name').length;
  });
  await page.evaluate(function () {
    const row = document.querySelector('#results-grid tbody');
    const tr = document.createElement('tr');
    ['Open', 'FIN 3000', 'LEC 06', 'Mo 6:00PM', 'VC 2-100', 'Smith,John A', '08/26 - 12/16']
      .forEach(function (value) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
    row.appendChild(tr);
  });
  // The rescan is debounced by 350ms and then queued on requestIdleCallback
  // with a 1200ms timeout, so it can legitimately take ~1.5s to land. Wait for
  // the new link instead of sleeping a fixed amount, then let the page settle
  // so that a second, duplicate pass would still show up in the count.
  await page.waitForFunction(
    function (want) { return document.querySelectorAll('a.rmpx-name').length >= want; },
    beforeRescan + 1,
    { timeout: 5000 }
  );
  await page.waitForTimeout(600);

  const afterRescan = await page.evaluate(function () {
    return document.querySelectorAll('a.rmpx-name').length;
  });

  check('a dynamically added row is annotated exactly once', function () {
    assert.strictEqual(afterRescan, beforeRescan + 1,
      'expected exactly one new link, went from ' + beforeRescan + ' to ' + afterRescan);
  });

  if (WANT_SHOTS) {
    await page.screenshot({ path: path.join(SHOTS_DIR, 'schedule-builder.png'), fullPage: true });
  }

  /* ---- teardown restores the page exactly ------------------------------ */

  const restored = await page.evaluate(function () {
    window.RMPX.badge.removeAll(document);
    const rows = Array.from(document.querySelectorAll('#results-grid tbody tr'));
    return {
      cells: rows.map(function (row) { return row.children[5].textContent; }),
      leftovers: document.querySelectorAll('[data-rmpx]').length,
    };
  });

  check('disabling the extension restores the original text exactly', function () {
    assert.deepStrictEqual(restored.cells, [
      'Smith,John A',
      'Garcia,Maria',
      'Staff',
      'Doe,Jane; Roe,Rick',
      'Nakamura,Kenji',
      'Smith,John A',
    ]);
  });

  check('teardown leaves no injected nodes behind', function () {
    assert.strictEqual(restored.leftovers, 0);
  });

  await browser.close();

  /* --------------------------------------------------------------------- */

  let failed = 0;
  checks.forEach(function (result) {
    if (result.ok) {
      console.log('  ok   ' + result.name);
    } else {
      failed += 1;
      console.log('  FAIL ' + result.name + '\n       ' + result.error);
    }
  });

  console.log('\n' + (checks.length - failed) + '/' + checks.length + ' DOM checks passed');
  if (WANT_SHOTS) console.log('screenshots written to ' + path.relative(ROOT, SHOTS_DIR));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
