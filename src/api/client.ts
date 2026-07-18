import { captureGraphqlBatch, BASE_URL } from '../browser/session.js';
import type { Page } from 'playwright';

// ─── Error types ──────────────────────────────────────────────────────────────

export class ThreadsAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = 'ThreadsAPIError';
  }
}

/** Thrown when the saved session is missing/expired — user must (re)log in. */
export class ThreadsAuthRequiredError extends ThreadsAPIError {
  constructor(endpoint?: string) {
    super(
      'Not signed in to Threads. Run `npm run login` (or `threads-mcp-login`) once ' +
        'to sign in with your Instagram account, then retry.',
      401,
      endpoint,
    );
    this.name = 'ThreadsAuthRequiredError';
  }
}

/** Thrown when Meta throttles us — back off and slow down. */
export class ThreadsRateLimitedError extends ThreadsAPIError {
  constructor(endpoint?: string) {
    super(
      'Threads rate-limited this request. Stop, wait several minutes, and reduce your ' +
        'action frequency before retrying.',
      429,
      endpoint,
    );
    this.name = 'ThreadsRateLimitedError';
  }
}

// ─── Read: collect the GraphQL bodies the app fires ────────────────────────────

/**
 * Navigate to `pageUrl` (optionally then run `trigger`) and collect every
 * GraphQL response the app emits. `friendlyName` is a *preference*, not a
 * requirement — extractors walk all bodies. Throws auth-required when nothing
 * came back (usually a dead session or a blocked page).
 */
export async function threadsCapture(
  pageUrl: string,
  friendlyName: string,
  opts: { trigger?: (page: Page) => Promise<void>; dwellMs?: number; timeoutMs?: number } = {},
): Promise<unknown[]> {
  let bodies: unknown[];
  try {
    bodies = await captureGraphqlBatch(
      pageUrl,
      { friendlyName, dwellMs: opts.dwellMs, timeoutMs: opts.timeoutMs },
      opts.trigger,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/429|rate.?limit/i.test(msg)) throw new ThreadsRateLimitedError(friendlyName);
    throw new ThreadsAPIError(
      `Browser error loading ${friendlyName}: ${msg}`,
      undefined,
      friendlyName,
    );
  }
  if (bodies.length === 0) throw new ThreadsAuthRequiredError(friendlyName);
  return bodies;
}

// ─── URL helpers ───────────────────────────────────────────────────────────────

/** Absolute Threads URL from a path. */
export function threadsUrl(pathAndQuery: string): string {
  return `${BASE_URL}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;
}

/** Normalize an @handle (strip leading @, lowercase). */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

/** URL for a user's profile. */
export function profileUrl(handle: string): string {
  return threadsUrl(`/@${normalizeHandle(handle)}`);
}

/** URL for a single post given its author handle and shortcode. */
export function postUrl(handle: string, code: string): string {
  return threadsUrl(`/@${normalizeHandle(handle)}/post/${code}`);
}
