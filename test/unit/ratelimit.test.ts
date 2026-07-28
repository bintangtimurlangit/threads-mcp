import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// The module reads its interval from the environment at import time, so set a
// short one before pulling it in — the default 8s would make this suite crawl.
const INTERVAL = 60;
process.env.THREADS_MIN_ACTION_INTERVAL_MS = String(INTERVAL);
const { throttleWrite, markWriteComplete, minIntervalMs } =
  await import('../../src/utils/ratelimit.js');

describe('throttleWrite', () => {
  test('reads the configured interval', () => {
    assert.equal(minIntervalMs(), INTERVAL);
  });

  test('measures the gap from when the previous write finished', async () => {
    // The regression: the clock was stamped on entry only, so a slow write
    // satisfied the whole interval while it was still running and the next one
    // fired immediately after it returned.
    await throttleWrite();
    await new Promise((r) => setTimeout(r, INTERVAL * 2)); // a slow write
    markWriteComplete();

    const t0 = Date.now();
    await throttleWrite();
    const waited = Date.now() - t0;
    assert.ok(
      waited >= INTERVAL * 0.9,
      `expected to wait ~${INTERVAL}ms after completion, waited ${waited}ms`,
    );
  });

  test('never returns faster than the configured floor', async () => {
    // Jitter is upward-only: the floor is the number the user set to stay safe.
    for (let i = 0; i < 5; i++) {
      markWriteComplete();
      const t0 = Date.now();
      await throttleWrite();
      const waited = Date.now() - t0;
      assert.ok(waited >= INTERVAL * 0.9, `gap ${waited}ms dipped below the ${INTERVAL}ms floor`);
    }
  });

  test('varies the gap rather than firing on a metronome', async () => {
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      markWriteComplete();
      const t0 = Date.now();
      await throttleWrite();
      gaps.push(Date.now() - t0);
    }
    assert.ok(
      new Set(gaps).size > 1,
      `all gaps identical (${gaps.join(',')}) — jitter not applied`,
    );
  });
});
