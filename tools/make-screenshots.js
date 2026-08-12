#!/usr/bin/env node
/**
 * Renders the Chrome Web Store screenshots.
 *
 *   npm run screenshots      # writes docs/store/*.png
 *
 * The store wants images at exactly 1280x800, so these are produced rather
 * than cropped by hand -- a listing has to be re-shot every time the UI moves,
 * and doing that manually is how listings end up showing a version of the
 * extension that no longer exists.
 *
 * Everything shown comes from test/fixtures, so no real student's schedule,
 * name or ratings ever ends up in a public store listing.
 *
 * Requires playwright (a dev dependency), same as the DOM tests.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error('Playwright is not installed. Run: npm install');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'store');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'schedule-builder.html');

const WIDTH = 1280;
const HEIGHT = 800;

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

/** Same canned data the DOM tests use, trimmed to what the shots display. */
const DB = {
  'john|smith': {
    status: 'match', confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/111',
    professor: {
      id: 'node-1', legacyId: '111', firstName: 'John', lastName: 'Smith',
      department: 'Accounting', numRatings: 116, avgRating: 3.6,
      avgDifficulty: 2.9, wouldTakeAgainPercent: 88,
      school: { id: 's1', name: 'Baruch College' },
    },
  },
  'maria|garcia': {
    status: 'match', confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/222',
    professor: {
      id: 'node-2', legacyId: '222', firstName: 'Maria', lastName: 'Garcia',
      department: 'Mathematics', numRatings: 31, avgRating: 2.1,
      avgDifficulty: 4.5, wouldTakeAgainPercent: 22,
      school: { id: 's1', name: 'Baruch College' },
    },
  },
  'adaeze|okonkwo': {
    status: 'match', confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/666',
    professor: {
      id: 'node-6', legacyId: '666', firstName: 'Adaeze', lastName: 'Okonkwo',
      department: 'History', numRatings: 47, avgRating: 4.9,
      avgDifficulty: 2.2, wouldTakeAgainPercent: 97,
      school: { id: 's1', name: 'Baruch College' },
    },
  },
  'miriam|hansman': {
    status: 'match', confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/888',
    professor: {
      id: 'node-8', legacyId: '888', firstName: 'Miriam', lastName: 'Hansman',
      department: 'Computer Information Systems', numRatings: 23, avgRating: 4.1,
      avgDifficulty: 3.0, wouldTakeAgainPercent: 81,
      school: { id: 's1', name: 'Baruch College' },
    },
  },
  'david|mcnutt': {
    status: 'match', confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/999',
    professor: {
      id: 'node-9', legacyId: '999', firstName: 'David', lastName: 'McNutt',
      department: 'Management', numRatings: 15, avgRating: 3.6,
      avgDifficulty: 3.3, wouldTakeAgainPercent: 66,
      school: { id: 's1', name: 'Baruch College' },
    },
  },
  'robert|alvarez': {
    status: 'match', confidence: 'high', ambiguous: false,
    url: 'https://www.ratemyprofessors.com/professor/777',
    professor: {
      id: 'node-7', legacyId: '777', firstName: 'Robert', lastName: 'Alvarez',
      department: 'Spanish', numRatings: 19, avgRating: 3.2,
      avgDifficulty: 3.4, wouldTakeAgainPercent: 55,
      school: { id: 's1', name: 'Baruch College' },
    },
  },
};

const DETAIL = {
  'node-1': {
    counts: { 1: 6, 2: 9, 3: 21, 4: 34, 5: 46 }, total: 116,
    tags: ['Tough grader', 'Lecture heavy', 'Test heavy', 'Participation matters'],
  },
};

function stub() {
  return `
    (function () {
      const DB = ${JSON.stringify(DB)};
      const DETAIL = ${JSON.stringify(DETAIL)};
      window.chrome = {
        runtime: {
          lastError: undefined,
          sendMessage: function (message, callback) {
            const respond = function (v) { setTimeout(function () { callback(v); }, 4); };
            if (message.type === 'rmpx:get-settings') {
              return respond({ ok: true, settings: {
                enabled: true, hoverCards: true, schoolMode: 'auto',
                manualSchoolKey: 'baruch', showDifficulty: true,
                showWouldTakeAgain: true, minRatingsForBadge: 1 } });
            }
            if (message.type === 'rmpx:lookup') {
              const hit = DB[message.payload.name.key];
              if (!hit) return respond({ ok: true, status: 'nomatch',
                searchUrl: 'https://www.ratemyprofessors.com/search/professors' });
              return respond(Object.assign({ ok: true }, hit));
            }
            if (message.type === 'rmpx:site-status') {
              return respond({ ok: true, supported: true, builtIn: true, enabled: true,
                origin: 'https://home.cunyfirst.cuny.edu' });
            }
            if (message.type === 'rmpx:detail') {
              const raw = DETAIL[message.payload.nodeId];
              if (!raw) return respond({ ok: true, status: 'nomatch' });
              let base = null;
              Object.keys(DB).forEach(function (k) {
                if (DB[k].professor.id === message.payload.nodeId) base = DB[k].professor;
              });
              return respond({ ok: true, status: 'ok', professor: Object.assign({}, base, {
                distribution: { counts: raw.counts, total: raw.total },
                tags: raw.tags.map(function (name, i) {
                  return { name: name, count: 29 - i * 6 };
                }),
              }) });
            }
            respond({ ok: false });
          },
        },
        storage: { onChanged: { addListener: function () {} } },
        tabs: { query: function (q, cb) { cb([{ url: 'https://home.cunyfirst.cuny.edu/' }]); } },
        permissions: { request: function (p, cb) { cb(true); } },
      };
    })();
  `;
}

async function loadFixture(browser) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.addInitScript(stub());
  await page.goto('file://' + FIXTURE);
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/styles.css') });
  for (const file of CONTENT_SCRIPTS) {
    await page.addScriptTag({ path: path.join(ROOT, file) });
  }
  await page.waitForSelector('.rmpx-badge[data-rmpx-state="match"]', { timeout: 5000 });
  await page.waitForTimeout(400);
  return page;
}

async function shotHoverCard(browser) {
  const page = await loadFixture(browser);
  await page.hover('a.rmpx-name[data-rmpx-person="john|smith"]');
  await page.waitForSelector('.rmpx-card__histogram', { timeout: 4000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, '1-hover-preview.png') });
  await page.close();
}

async function shotBadges(browser) {
  const page = await loadFixture(browser);
  await page.screenshot({ path: path.join(OUT, '2-inline-badges.png') });
  await page.close();
}

async function shotPopup(browser) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.addInitScript(stub());
  await page.goto('file://' + path.join(ROOT, 'src/popup/popup.html'));
  // The popup is 320px wide by design; float it on a backdrop so the shot is
  // not 960px of empty white.
  await page.addStyleTag({
    content: `
      html { display: flex; align-items: center; justify-content: center;
             min-height: 100vh; background: #eef1f5; }
      body { box-shadow: 0 18px 50px rgba(1, 29, 73, 0.22);
             border-radius: 14px; overflow: hidden; }
    `,
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '3-popup.png') });
  await page.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  await shotHoverCard(browser);
  await shotBadges(browser);
  await shotPopup(browser);

  await browser.close();

  fs.readdirSync(OUT).sort().forEach(function (file) {
    const bytes = fs.statSync(path.join(OUT, file)).size;
    console.log('  ' + file.padEnd(24) + Math.round(bytes / 1024) + ' KB');
  });
  console.log('\n' + WIDTH + 'x' + HEIGHT + ', written to ' + path.relative(ROOT, OUT));
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
