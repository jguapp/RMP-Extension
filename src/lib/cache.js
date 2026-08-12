/**
 * A small TTL cache layered over chrome.storage.local.
 *
 * Two goals: keep the page fast on repeat visits (a full Schedule Builder
 * result page can contain 40+ instructors), and keep our request volume
 * against Rate My Professors low and polite.
 *
 * Misses are cached too -- with a shorter lifetime -- so that a professor with
 * no RMP profile does not trigger a network round trip on every scroll.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});

  const PREFIX = 'rmpx:v1:';
  const MAX_ENTRIES = 1500;

  /** In-memory mirror so a single page render does not hammer storage. */
  const memory = new Map();

  function storageArea() {
    const api = root.chrome || root.browser;
    return api && api.storage && api.storage.local ? api.storage.local : null;
  }

  function now() {
    return Date.now();
  }

  function storageGet(keys) {
    const area = storageArea();
    if (!area) return Promise.resolve({});
    return new Promise(function (resolve) {
      try {
        area.get(keys, function (result) {
          void (root.chrome && root.chrome.runtime && root.chrome.runtime.lastError);
          resolve(result || {});
        });
      } catch (err) {
        resolve({});
      }
    });
  }

  function storageSet(items) {
    const area = storageArea();
    if (!area) return Promise.resolve();
    return new Promise(function (resolve) {
      try {
        area.set(items, function () {
          void (root.chrome && root.chrome.runtime && root.chrome.runtime.lastError);
          resolve();
        });
      } catch (err) {
        resolve();
      }
    });
  }

  function storageRemove(keys) {
    const area = storageArea();
    if (!area) return Promise.resolve();
    return new Promise(function (resolve) {
      try {
        area.remove(keys, function () {
          void (root.chrome && root.chrome.runtime && root.chrome.runtime.lastError);
          resolve();
        });
      } catch (err) {
        resolve();
      }
    });
  }

  function fullKey(key) {
    return PREFIX + key;
  }

  /** Returns the stored value, or undefined when absent or expired. */
  async function get(key) {
    const stored = memory.get(key);
    if (stored) {
      if (stored.expiresAt > now()) return stored.value;
      memory.delete(key);
    }

    const raw = await storageGet(fullKey(key));
    const entry = raw[fullKey(key)];
    if (!entry || typeof entry !== 'object') return undefined;
    if (typeof entry.expiresAt !== 'number' || entry.expiresAt <= now()) {
      await storageRemove(fullKey(key));
      return undefined;
    }

    memory.set(key, entry);
    return entry.value;
  }

  async function set(key, value, ttlMs) {
    const entry = {
      value: value,
      expiresAt: now() + (Number(ttlMs) || RMPX.TTL.HIT_MS),
      storedAt: now(),
    };
    memory.set(key, entry);
    const items = {};
    items[fullKey(key)] = entry;
    await storageSet(items);
  }

  /**
   * Fetch-through helper with in-flight de-duplication: forty badges asking
   * for the same professor at once produce exactly one network request.
   *
   * `ttlMs` may be a function of the fetched value, which is how a miss gets a
   * shorter lifetime than a hit -- whether a lookup missed is only known after
   * the producer has run.
   */
  const inFlight = new Map();

  async function getOrFetch(key, ttlMs, producer) {
    const cached = await get(key);
    if (cached !== undefined) return cached;

    if (inFlight.has(key)) return inFlight.get(key);

    const promise = (async function () {
      try {
        const value = await producer();
        // A thrown producer never reaches here, so transient network failures
        // are not cached as permanent misses.
        await set(key, value, typeof ttlMs === 'function' ? ttlMs(value) : ttlMs);
        return value;
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, promise);
    return promise;
  }

  /** Drop expired entries, then trim the oldest if we are over budget. */
  async function prune() {
    const all = await storageGet(null);
    const keys = Object.keys(all).filter(function (k) { return k.startsWith(PREFIX); });
    const current = now();
    const doomed = [];
    const survivors = [];

    keys.forEach(function (k) {
      const entry = all[k];
      if (!entry || typeof entry.expiresAt !== 'number' || entry.expiresAt <= current) {
        doomed.push(k);
      } else {
        survivors.push({ key: k, storedAt: entry.storedAt || 0 });
      }
    });

    if (survivors.length > MAX_ENTRIES) {
      survivors.sort(function (a, b) { return a.storedAt - b.storedAt; });
      survivors.slice(0, survivors.length - MAX_ENTRIES).forEach(function (s) {
        doomed.push(s.key);
      });
    }

    if (doomed.length) {
      doomed.forEach(function (k) { memory.delete(k.slice(PREFIX.length)); });
      await storageRemove(doomed);
    }
    return doomed.length;
  }

  RMPX.cache = {
    PREFIX: PREFIX,
    get: get,
    set: set,
    getOrFetch: getOrFetch,
    prune: prune,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RMPX.cache;
})(typeof self !== 'undefined' ? self : globalThis);
