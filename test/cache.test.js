'use strict';

const test = require('node:test');
const assert = require('node:assert');

require('../src/lib/namespace.js');

/**
 * cache.js talks to chrome.storage.local. There is no such thing under node, so
 * stub the one shape it uses before loading it. Everything then runs against
 * the in-memory mirror plus this fake area.
 */
const store = {};
globalThis.chrome = {
  runtime: { lastError: undefined },
  storage: {
    local: {
      get: function (keys, cb) {
        if (keys === null) return cb(Object.assign({}, store));
        const out = {};
        [].concat(keys).forEach(function (k) {
          if (k in store) out[k] = store[k];
        });
        cb(out);
      },
      set: function (items, cb) { Object.assign(store, items); cb(); },
      remove: function (keys, cb) {
        [].concat(keys).forEach(function (k) { delete store[k]; });
        cb();
      },
    },
  },
};

const cache = require('../src/lib/cache.js');
const { TTL } = globalThis.RMPX;

test('a fixed ttl is applied to the stored entry', async function () {
  const before = Date.now();
  await cache.getOrFetch('fixed', 1000, async function () { return 'value'; });

  const entry = store[cache.PREFIX + 'fixed'];
  assert.ok(entry, 'nothing was written to storage');
  assert.ok(entry.expiresAt >= before + 1000);
});

test('the ttl may be computed from the fetched value', async function () {
  // Regression: TTL.MISS_MS existed and was documented ("misses expire sooner
  // so new professors show up quickly") but nothing ever used it -- every
  // lookup, hit or miss, was cached for the full 7-day HIT_MS. A professor who
  // had just joined RMP stayed invisible for a week.
  const ttlFor = function (result) {
    return result && result.status === 'match' ? TTL.HIT_MS : TTL.MISS_MS;
  };

  const start = Date.now();
  await cache.getOrFetch('a-hit', ttlFor, async function () {
    return { status: 'match' };
  });
  await cache.getOrFetch('a-miss', ttlFor, async function () {
    return { status: 'nomatch' };
  });

  const hit = store[cache.PREFIX + 'a-hit'].expiresAt - start;
  const miss = store[cache.PREFIX + 'a-miss'].expiresAt - start;

  assert.ok(Math.abs(hit - TTL.HIT_MS) < 5000, 'a match should keep the long ttl');
  assert.ok(Math.abs(miss - TTL.MISS_MS) < 5000, 'a miss should expire sooner');
  assert.ok(miss < hit, 'a miss must not outlive a hit');
});

test('identical in-flight requests produce exactly one fetch', async function () {
  let calls = 0;
  const producer = async function () {
    calls += 1;
    return 'once';
  };

  const results = await Promise.all([
    cache.getOrFetch('shared', 1000, producer),
    cache.getOrFetch('shared', 1000, producer),
    cache.getOrFetch('shared', 1000, producer),
  ]);

  assert.deepStrictEqual(results, ['once', 'once', 'once']);
  assert.strictEqual(calls, 1, 'a results page with 40 badges must not fan out');
});

test('a thrown producer is not cached as a permanent miss', async function () {
  await assert.rejects(cache.getOrFetch('flaky', 1000, async function () {
    throw new Error('network down');
  }));
  assert.ok(!(cache.PREFIX + 'flaky' in store), 'a transient failure must not be stored');
});

test('an expired entry is treated as absent', async function () {
  await cache.set('stale', 'old', -1000);
  assert.strictEqual(await cache.get('stale'), undefined);
});
