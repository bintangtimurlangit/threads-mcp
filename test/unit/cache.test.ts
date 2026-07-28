import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cache, invalidateAfterWrite } from '../../src/utils/cache.js';

describe('cache', () => {
  beforeEach(() => cache.clear());

  test('round-trips a value', () => {
    cache.set('k', 'v');
    assert.equal(cache.get<string>('k'), 'v');
  });

  test('misses on an unknown key', () => {
    assert.equal(cache.get('nope'), undefined);
  });

  test('key() distinguishes different argument sets', () => {
    assert.notEqual(cache.key('timeline', 15), cache.key('timeline', 30));
    assert.equal(cache.key('profile', 'alice'), cache.key('profile', 'alice'));
  });

  test('a write drops every cached read', () => {
    // Guards the bug where get_profile right after create_thread served the
    // pre-post snapshot and made a successful post look like a no-op.
    cache.set('profile:alice', 'stale');
    cache.set('timeline:15', 'stale');
    invalidateAfterWrite();
    assert.equal(cache.get('profile:alice'), undefined);
    assert.equal(cache.get('timeline:15'), undefined);
  });

  test('is bounded, and evicts least-recently-used first', () => {
    for (let i = 0; i < 600; i++) cache.set(`u:${i}`, i);
    assert.equal(cache.size(), 500);
    assert.equal(cache.get('u:0'), undefined, 'oldest evicted');
    assert.equal(cache.get('u:599'), 599, 'newest retained');
  });

  test('reading a key protects it from eviction', () => {
    cache.set('hot', 'H');
    for (let i = 0; i < 499; i++) cache.set(`c:${i}`, i);
    cache.get('hot'); // touch
    for (let i = 0; i < 200; i++) cache.set(`d:${i}`, i);
    assert.equal(cache.get('hot'), 'H');
  });
});
