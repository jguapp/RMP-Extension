#!/usr/bin/env node
/**
 * Assembles a loadable extension folder per browser.
 *
 *   node tools/build.js              # all three
 *   node tools/build.js firefox      # just one
 *
 * Output goes to dist/<target>/. The repo root stays a working Chrome
 * extension in its own right -- manifest.json there is rewritten from the same
 * generator, so "Load unpacked" on the repo folder keeps working and cannot
 * drift from what the build produces.
 *
 * There is no bundling, minifying or transpiling here, and there is not meant
 * to be: every file is a classic script that the browser loads as-is, which is
 * what lets the same source run in three engines and under node --test.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { TARGETS, buildManifest } = require('./manifests.js');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

/** Everything an installed extension needs, and nothing else. */
const PAYLOAD = ['src', 'icons'];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach(function (entry) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  });
}

function countFiles(dir) {
  let total = 0;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.isDirectory()) total += countFiles(path.join(dir, entry.name));
    else total += 1;
  });
  return total;
}

function writeManifest(file, manifest) {
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}

function build(target) {
  const out = path.join(DIST, target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  PAYLOAD.forEach(function (dir) {
    copyDir(path.join(ROOT, dir), path.join(out, dir));
  });
  writeManifest(path.join(out, 'manifest.json'), buildManifest(target));

  console.log('  ' + target.padEnd(8) + path.relative(ROOT, out).replace(/\\/g, '/') +
    '  (' + countFiles(out) + ' files)');
}

function main() {
  const requested = process.argv.slice(2).filter(function (arg) {
    return !arg.startsWith('-');
  });
  const targets = requested.length ? requested : TARGETS;

  targets.forEach(function (target) {
    if (TARGETS.indexOf(target) === -1) {
      console.error('unknown target: ' + target + ' (expected ' + TARGETS.join(', ') + ')');
      process.exit(1);
    }
  });

  console.log('building:');
  targets.forEach(build);

  // The repo root's own manifest.json is hand-maintained and deliberately left
  // alone -- it is what "Load unpacked" points at, and rewriting it under
  // someone mid-session is a good way to break a working setup. A test asserts
  // it still matches buildManifest('chrome') semantically, so the two cannot
  // drift; if that fails, edit manifest.json to match rather than the reverse.
}

main();
