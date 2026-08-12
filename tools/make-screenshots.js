#!/usr/bin/env node
/**
 * Produces the Chrome Web Store screenshots, which must be exactly 1280x800.
 *
 *   npm run screenshots            # render the popup
 *   npm run screenshots -- --raw   # reframe real captures from docs/store/raw/
 *
 * Two sources, split by whether the shot contains anything real:
 *
 *   rendered   Only the popup, which shows no professor data at all. A
 *              rendered one is identical to a real one, and rendering it means
 *              it can be redone whenever the UI moves.
 *
 *   --raw      Everything that shows a schedule. A mocked-up listing full of
 *              "John Smith" reads as a mock-up, and these cannot be automated
 *              anyway: Schedule Builder sits behind a CUNY login. Drop
 *              hand-captured images in docs/store/raw/ and this reframes them
 *              to the size the store requires.
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
const RAW = path.join(OUT, 'raw');

const WIDTH = 1280;
const HEIGHT = 800;

/* -------------------------------------------------------------------------- *
 * The popup
 * -------------------------------------------------------------------------- */

/** Just enough of the extension API for the popup to render its two panels. */
const POPUP_STUB = `
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
        if (message.type === 'rmpx:site-status') {
          return respond({ ok: true, supported: true, builtIn: true, enabled: true,
            origin: 'https://sb.cunyfirst.cuny.edu' });
        }
        respond({ ok: true });
      },
    },
    storage: { onChanged: { addListener: function () {} } },
    tabs: { query: function (q, cb) { cb([{ url: 'https://sb.cunyfirst.cuny.edu/' }]); } },
    permissions: { request: function (p, cb) { cb(true); } },
  };
`;

async function shotPopup(browser) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.addInitScript(POPUP_STUB);
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
  console.log('  3-popup.png              rendered');
}

/* -------------------------------------------------------------------------- *
 * Normalising real captures
 * -------------------------------------------------------------------------- */

/** Width and height straight out of a PNG's IHDR chunk. */
function pngSize(file) {
  const head = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 24, 0);
  fs.closeSync(fd);
  if (head.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/**
 * Reframe a capture to exactly 1280x800.
 *
 * Cover rather than letterbox: bars down the side of a store screenshot look
 * like a mistake. Anchored to the top, because a browser capture keeps its
 * useful content there and any crop should come off the bottom.
 */
async function normalise(browser, file) {
  const source = path.join(RAW, file);
  const data = fs.readFileSync(source).toString('base64');
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext;

  const size = ext === 'png' ? pngSize(source) : null;
  let note = '';
  if (size) {
    note = size.width + 'x' + size.height;
    if (size.width < WIDTH || size.height < HEIGHT) {
      note += '   ** smaller than ' + WIDTH + 'x' + HEIGHT +
        ', will look soft — recapture larger';
    }
  }

  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.setContent(
    '<style>html,body{margin:0;height:100%;background:#fff}' +
    'img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}</style>' +
    '<img src="data:' + mime + ';base64,' + data + '">'
  );
  await page.waitForTimeout(120);

  const out = file.replace(/\.[^.]+$/, '') + '.png';
  await page.screenshot({ path: path.join(OUT, out) });
  await page.close();

  console.log('  ' + file.padEnd(24) + ' -> ' + out.padEnd(24) + note);
}

async function fromRaw(browser) {
  if (!fs.existsSync(RAW)) {
    console.error('No docs/store/raw/ directory.');
    process.exit(1);
  }

  const files = fs.readdirSync(RAW)
    .filter(function (f) { return /\.(png|jpe?g)$/i.test(f); })
    .sort();

  if (!files.length) {
    console.error('docs/store/raw/ has no .png or .jpg files in it.\n');
    console.error('Schedule Builder needs a CUNY login, so these have to be');
    console.error('captured by hand. See docs/store/raw/README.md.');
    process.exit(1);
  }

  for (const file of files) await normalise(browser, file);
}

/* -------------------------------------------------------------------------- */

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  if (process.argv.includes('--raw')) await fromRaw(browser);
  else await shotPopup(browser);

  await browser.close();
  console.log('\n' + WIDTH + 'x' + HEIGHT + ', written to ' +
    path.relative(ROOT, OUT).split(path.sep).join('/'));
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
