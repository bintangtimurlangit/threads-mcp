import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { asLimit } from '../../src/prompts.js';

describe('asLimit', () => {
  test('parses a numeric string', () => {
    assert.equal(asLimit('25', 20), 25);
  });

  test('falls back when absent or unparseable', () => {
    // MCP prompt arguments are strings on the wire and optional args simply
    // arrive undefined — neither may produce NaN in the rendered prompt.
    assert.equal(asLimit(undefined, 20), 20);
    assert.equal(asLimit('', 20), 20);
    assert.equal(asLimit('lots', 20), 20);
    assert.equal(asLimit('NaN', 20), 20);
  });

  test('clamps to the maximum', () => {
    assert.equal(asLimit('9999', 20, 50), 50);
    assert.equal(asLimit('9999', 20, 100), 100);
  });

  test('rejects zero and negatives rather than passing them to a tool', () => {
    assert.equal(asLimit('0', 20), 20);
    assert.equal(asLimit('-5', 20), 20);
  });

  test('tolerates a decimal string', () => {
    assert.equal(asLimit('12.9', 20), 12);
  });
});
