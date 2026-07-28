import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePost } from '../../src/tools/read.js';
import { parseDuration } from '../../src/tools/schedule.js';

describe('parsePost', () => {
  test('parses a full permalink', () => {
    assert.deepEqual(parsePost('https://www.threads.com/@alice/post/ABC123'), {
      handle: 'alice',
      code: 'ABC123',
    });
  });

  test('parses handles containing dots and underscores', () => {
    assert.deepEqual(parsePost('https://www.threads.com/@a.b_c/post/XYZ'), {
      handle: 'a.b_c',
      code: 'XYZ',
    });
  });

  test('recovers the code from a handle-less permalink', () => {
    // Threads serves these and shares use them; before this they parsed to
    // null, which lost the code and made get_thread_replies emit the root post
    // as its own first reply.
    assert.deepEqual(parsePost('https://www.threads.com/post/ABC123'), { code: 'ABC123' });
  });

  test('accepts a bare shortcode', () => {
    assert.deepEqual(parsePost('ABC123'), { code: 'ABC123' });
    assert.deepEqual(parsePost('  ABC123  '), { code: 'ABC123' });
  });

  test('rejects input with no recoverable code', () => {
    assert.equal(parsePost('https://example.com/'), null);
    assert.equal(parsePost('short'), null, 'below the 6-char shortcode floor');
    assert.equal(parsePost(''), null);
  });
});

describe('parseDuration', () => {
  test('parses each unit', () => {
    assert.equal(parseDuration('45s'), 45_000);
    assert.equal(parseDuration('30m'), 1_800_000);
    assert.equal(parseDuration('2h'), 7_200_000);
    assert.equal(parseDuration('3d'), 259_200_000);
  });

  test('accepts long forms, spacing and mixed case', () => {
    assert.equal(parseDuration('30 mins'), 1_800_000);
    assert.equal(parseDuration('2 HOURS'), 7_200_000);
    assert.equal(parseDuration('1 day'), 86_400_000);
  });

  test('rejects nonsense rather than guessing a delay', () => {
    // Guessing here would schedule a real post at the wrong time.
    assert.equal(parseDuration('soon'), null);
    assert.equal(parseDuration('2 weeks'), null);
    assert.equal(parseDuration('-5m'), null);
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration('5'), null);
  });
});
