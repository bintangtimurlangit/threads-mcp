import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { prune, type ScheduledJob, type JobStatus } from '../../src/scheduler.js';

let n = 0;
function job(status: JobStatus, firedDaysAgo?: number): ScheduledJob {
  const at = new Date(Date.now() - (firedDaysAgo ?? 0) * 86_400_000).toISOString();
  return {
    id: `j${n++}`,
    at,
    createdAt: at,
    status,
    ...(firedDaysAgo === undefined ? {} : { firedAt: at }),
  };
}

describe('prune', () => {
  test('never drops pending or running jobs', () => {
    // Dropping one would silently cancel a post the user scheduled — the one
    // outcome this function must never produce.
    const all = [
      ...Array.from({ length: 200 }, () => job('done', 1)),
      job('pending'),
      job('running'),
    ];
    const kept = prune(all);
    assert.equal(kept.filter((j) => j.status === 'pending').length, 1);
    assert.equal(kept.filter((j) => j.status === 'running').length, 1);
  });

  test('caps finished history at the retention count', () => {
    const kept = prune(Array.from({ length: 200 }, () => job('done', 1)));
    assert.equal(kept.length, 50);
  });

  test('keeps the most recent finished jobs, not the oldest', () => {
    const old = job('done', 20);
    const recent = job('done', 1);
    const kept = prune([old, ...Array.from({ length: 60 }, () => job('done', 10)), recent]);
    assert.ok(
      kept.some((j) => j.id === recent.id),
      'most recent finished job must survive',
    );
    assert.ok(!kept.some((j) => j.id === old.id), 'oldest should be dropped first');
  });

  test('drops finished jobs past the age cutoff even when under the count', () => {
    const stale = job('done', 45);
    const fresh = job('failed', 2);
    const kept = prune([stale, fresh]);
    assert.deepEqual(
      kept.map((j) => j.id),
      [fresh.id],
    );
  });

  test('treats canceled as finished', () => {
    const kept = prune(Array.from({ length: 80 }, () => job('canceled', 1)));
    assert.equal(kept.length, 50);
  });

  test('keeps a finished job with an unparseable timestamp rather than losing it', () => {
    const weird = { ...job('done'), at: 'not-a-date', firedAt: undefined };
    assert.equal(prune([weird]).length, 1);
  });

  test('is a no-op on an empty queue', () => {
    assert.deepEqual(prune([]), []);
  });
});
