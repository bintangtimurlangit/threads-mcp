// ─── Write-action rate limiter ────────────────────────────────────────────────
//
// You are automating a REAL Threads account. Meta rate-limits aggressively and
// can restrict/ban accounts that behave like bots (bursty posting, rapid
// follow/like loops). This module enforces a minimum gap between *write* actions
// as a safety rail, and surfaces a reminder so the model/user stay disciplined.

const MIN_INTERVAL_MS = parseInt(process.env.THREADS_MIN_ACTION_INTERVAL_MS ?? '8000', 10);

let lastActionAt = 0;

/**
 * Block until it's safe to perform the next write action, honoring
 * THREADS_MIN_ACTION_INTERVAL_MS. Call this at the start of every write tool.
 */
export async function throttleWrite(): Promise<void> {
  const now = Date.now();
  const wait = lastActionAt + MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
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
