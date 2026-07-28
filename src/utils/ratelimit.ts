// ─── Write-action rate limiter ────────────────────────────────────────────────
//
// You are automating a REAL Threads account. Meta rate-limits aggressively and
// can restrict/ban accounts that behave like bots (bursty posting, rapid
// follow/like loops). This module enforces a minimum gap between *write* actions
// as a safety rail, and surfaces a reminder so the model/user stay disciplined.

const MIN_INTERVAL_MS = parseInt(process.env.THREADS_MIN_ACTION_INTERVAL_MS ?? '8000', 10);

/**
 * Extra delay added on top of the minimum, as a fraction of it.
 *
 * Upward-only, deliberately: jitter must never dip below the configured floor,
 * which is the number the user chose to stay safe. A gap that is *exactly*
 * 8000ms every single time is itself a signal — people don't act on a metronome
 * — so the goal is irregularity, never a shorter wait.
 */
const JITTER_FRACTION = 0.35;

let lastActionAt = 0;

function nextGapMs(): number {
  return MIN_INTERVAL_MS * (1 + Math.random() * JITTER_FRACTION);
}

/**
 * Block until it's safe to perform the next write action, honoring
 * THREADS_MIN_ACTION_INTERVAL_MS. Call this at the start of every write tool.
 *
 * The clock is stamped here *and* again by `markWriteComplete`, so the enforced
 * gap runs from when the previous write finished. Stamping only on entry (as
 * this used to) measured start-to-start: a 40-second media upload satisfied the
 * entire interval while it was still running, and the next write fired the
 * instant it returned — precisely the burst this exists to prevent.
 */
export async function throttleWrite(): Promise<void> {
  const wait = lastActionAt + nextGapMs() - Date.now();
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  // Provisional stamp, so anything queued behind us still spaces out even
  // before this write finishes.
  lastActionAt = Date.now();
}

/** Re-stamp once a write has actually completed. See `throttleWrite`. */
export function markWriteComplete(): void {
  lastActionAt = Date.now();
}

/** A short reminder appended to every write result. */
export function rateLimitReminder(): string {
  const seconds = Math.round(MIN_INTERVAL_MS / 1000);
  return (
    `\n\n⏳ _Rate-limit note: this is a real account. The server spaces writes ≥${seconds}s apart. ` +
    `Avoid rapid post/follow/like loops — Meta can restrict accounts for automation-like bursts._`
  );
}

/** Human label for the enforced interval (for docs / diagnostics). */
export function minIntervalMs(): number {
  return MIN_INTERVAL_MS;
}
