import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TOKEN_PATTERN, TunnelStore } from '../src/stream/store.js';

const entry = { url: 'https://cdn.test/a.mp4', filename: 'a.mp4', contentType: 'video/mp4' };

describe('TunnelStore', () => {
  it('creates url-safe tokens that resolve to the entry', () => {
    const store = new TunnelStore({ ttlMs: 1000, maxEntries: 10 });
    const token = store.create(entry);
    assert.match(token, TOKEN_PATTERN);
    assert.deepEqual(store.get(token), entry);
  });

  it('expires entries after the ttl', () => {
    let now = 1_000;
    const store = new TunnelStore({ ttlMs: 500, maxEntries: 10, now: () => now });
    const token = store.create(entry);
    now += 499;
    assert.ok(store.get(token));
    now += 1;
    assert.equal(store.get(token), null);
    assert.equal(store.size, 0);
  });

  it('evicts the oldest entry when full', () => {
    const store = new TunnelStore({ ttlMs: 1000, maxEntries: 2 });
    const first = store.create(entry);
    const second = store.create(entry);
    const third = store.create(entry);
    assert.equal(store.size, 2);
    assert.equal(store.get(first), null);
    assert.ok(store.get(second));
    assert.ok(store.get(third));
  });

  it('rejects malformed tokens without touching the map', () => {
    const store = new TunnelStore({ ttlMs: 1000, maxEntries: 2 });
    for (const token of ['', 'short', '../../etc/passwd', 'x'.repeat(25), '__proto__']) {
      assert.equal(store.get(token), null);
    }
  });
});
