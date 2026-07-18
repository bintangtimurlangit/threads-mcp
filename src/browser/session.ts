import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';
import type { BrowserContext, Page, Response } from 'playwright';

// ─── Configuration ────────────────────────────────────────────────────────────

export const DOMAIN = process.env.THREADS_DOMAIN || 'threads.com';
export const BASE_URL = `https://www.${DOMAIN}`;

export const PROFILE_DIR =
  process.env.THREADS_PROFILE_DIR || path.join(os.homedir(), '.threads-mcp', 'chrome-profile');

// Meta detects headless even with fingerprint patches, so we run HEADED by
// default (needs a display: WSLg, a desktop X server, or xvfb for servers).
// Set THREADS_HEADLESS=true only to experiment.
const HEADLESS = process.env.THREADS_HEADLESS === 'true';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function debug(msg: string): void {
  if (process.env.DEBUG === 'true') process.stderr.write(`[threads-mcp] ${msg}\n`);
}

// ─── Context singleton ────────────────────────────────────────────────────────
//
// Threads' web app talks to Meta's Relay GraphQL gateway (/api/graphql) with
// per-session tokens (fb_dtsg, lsd) and anti-automation fingerprinting. Rather
// than hand-forge signed requests, we drive CloakBrowser (a fingerprint-patched
// Chromium) against a persistent profile the user logs into once (npm run
// login). READS intercept the GraphQL responses the app itself fires; WRITES
// drive the real composer/action UI so Meta's own client mints the tokens.

let contextPromise: Promise<BrowserContext> | null = null;

async function createContext(headless: boolean): Promise<BrowserContext> {
  debug(`Launching CloakBrowser (headless=${headless}) with profile: ${PROFILE_DIR}`);
  const ctx = (await launchPersistentContext({
    userDataDir: PROFILE_DIR,
    headless,
    userAgent: USER_AGENT,
    locale: 'en-US',
    timezone: 'Asia/Jakarta',
    viewport: { width: 1366, height: 900 },
    humanize: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })) as unknown as BrowserContext;
  return ctx;
}

/**
 * Get the shared browser context, launching it on first use.
 * `headless` overrides the env default (the login flow forces a visible window).
 */
export async function getContext(headless: boolean = HEADLESS): Promise<BrowserContext> {
  if (!contextPromise) contextPromise = createContext(headless);
  return contextPromise;
}

/** The single reused page. */
export async function getPage(): Promise<Page> {
  const ctx = await getContext();
  const existing = ctx.pages().find((p) => !p.isClosed());
  return existing ?? (await ctx.newPage());
}

// ─── Serialized navigation + interception ──────────────────────────────────────
//
// A single page is shared across tool calls; serialize access so overlapping
// calls don't clobber each other's navigation.

let lock: Promise<unknown> = Promise.resolve();
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

export interface BatchOptions {
  /**
   * Preferred GraphQL operation, matched against the request's
   * `fb_api_req_friendly_name` (the app names every query), e.g.
   * "ProfileThreadsTab" or "PostPage". If seen, we stop dwelling early and
   * return it first — but we still collect every other GraphQL body, so a
   * drifted/renamed op degrades gracefully instead of timing out.
   */
  friendlyName?: string;
  /** How long to keep collecting responses after load/trigger (ms, default 3500). */
  dwellMs?: number;
  /** Navigation timeout (ms, default 30000). */
  timeoutMs?: number;
}

/** Pull `fb_api_req_friendly_name` out of a GraphQL POST body (form-encoded). */
function friendlyNameOf(postData: string | null): string | undefined {
  if (!postData) return undefined;
  const m = postData.match(/fb_api_req_friendly_name=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/**
 * Parse a GraphQL response body. Meta usually returns a single JSON object, but
 * some streamed responses are newline-delimited JSON. Handle both; return every
 * object we could parse.
 */
function parseJsonBodies(txt: string): unknown[] {
  const trimmed = txt.trim();
  if (!trimmed) return [];
  try {
    return [JSON.parse(trimmed)];
  } catch {
    /* fall through to line-by-line */
  }
  const out: unknown[] = [];
  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      /* skip non-JSON chunk */
    }
  }
  return out;
}

/**
 * Navigate to `pageUrl` (optionally then run `trigger`) and collect the JSON
 * bodies of every `/api/graphql` response the app fires — the queries carry
 * valid fb_dtsg / lsd tokens. Returns all captured bodies, with any matching
 * `opts.friendlyName` first. Callers walk the bodies with defensive extractors,
 * so we don't depend on Meta keeping operation names stable.
 */
export async function captureGraphqlBatch<T = unknown>(
  pageUrl: string,
  opts: BatchOptions = {},
  trigger?: (page: Page) => Promise<void>,
): Promise<T[]> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const dwellMs = opts.dwellMs ?? 3500;

  return withLock(async () => {
    const page = await getPage();
    const collected: Array<{ name?: string; json: unknown }> = [];
    const pending: Array<Promise<void>> = [];

    const listener = (r: Response) => {
      // Threads uses two GraphQL endpoints: /api/graphql (profile/post surfaces)
      // AND /graphql/query (the home feed — BarcelonaFeedDirectQuery). Match both.
      if (!r.url().includes('graphql')) return;
      const name = friendlyNameOf(r.request().postData());
      if (process.env.DEBUG === 'true' && name) debug(`saw GraphQL: ${name}`);
      pending.push(
        r.text().then(
          (txt) => {
            for (const json of parseJsonBodies(txt)) collected.push({ name, json });
          },
          () => {},
        ),
      );
    };

    page.on('response', listener);
    try {
      if (trigger) {
        if (!page.url().startsWith(pageUrl)) {
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        }
        await trigger(page);
      } else {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      }

      const deadline = Date.now() + dwellMs;
      while (Date.now() < deadline) {
        await page.waitForTimeout(250);
        if (opts.friendlyName && collected.some((b) => b.name?.includes(opts.friendlyName!))) {
          await page.waitForTimeout(500); // let sibling queries land
          break;
        }
      }
    } finally {
      page.off('response', listener);
    }

    await Promise.allSettled(pending);

    // Threads server-renders profile/post/feed data into <script type="application/json">
    // blocks in the initial HTML — the primary data source. The live /api/graphql
    // responses above only cover lazy/secondary queries (side-nav, scroll pagination).
    // Harvest the embedded blocks and put them first (they're the top of the page).
    const embedded: unknown[] = [];
    try {
      const raws = await page.$$eval('script[type="application/json"]', (nodes) =>
        (nodes as Array<{ textContent: string | null }>).map((n) => n.textContent || ''),
      );
      for (const raw of raws) {
        if (raw.length < 40) continue;
        try {
          embedded.push(JSON.parse(raw));
        } catch {
          /* not standalone JSON — skip */
        }
      }
      if (process.env.DEBUG === 'true') debug(`harvested ${embedded.length} embedded JSON blocks`);
    } catch {
      /* page may have navigated away — ignore */
    }

    const named = opts.friendlyName
      ? collected.filter((b) => b.name?.includes(opts.friendlyName!))
      : [];
    const rest = collected.filter((b) => !named.includes(b));
    return [...embedded, ...named.map((b) => b.json), ...rest.map((b) => b.json)] as T[];
  });
}

/**
 * Run an arbitrary UI action on the shared page under the nav lock. Used by the
 * write tools (compose, like, follow, …) which drive Threads' real controls.
 */
export function onPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  return withLock(async () => fn(await getPage()));
}

/** Warm the session once (loads Threads so the app + tokens initialise). */
export async function warm(): Promise<void> {
  await withLock(async () => {
    const page = await getPage();
    if (!page.url().includes(DOMAIN)) {
      debug('Warming session on Threads home…');
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
    }
  });
}

/** Best-effort check that the saved profile is logged in. */
export async function isLoggedIn(): Promise<boolean> {
  const ctx = await getContext();
  // Threads/Meta set `sessionid` and `ds_user_id` on the *.threads.com domain
  // (and on .instagram.com) once authenticated.
  const cookies = await ctx.cookies([BASE_URL, `https://${DOMAIN}`, 'https://www.instagram.com']);
  return cookies.some((c) => c.name === 'sessionid' && c.value.length > 8);
}

/** The logged-in user's numeric id, read from the `ds_user_id` cookie. */
export async function currentUserId(): Promise<string | undefined> {
  const ctx = await getContext();
  const cookies = await ctx.cookies([BASE_URL, `https://${DOMAIN}`, 'https://www.instagram.com']);
  return cookies.find((c) => c.name === 'ds_user_id')?.value;
}

let cachedHandle: string | undefined;

/**
 * Resolve the logged-in user's @handle by reading the Profile nav link on the
 * home page (its href is `/@handle`). Cached after first success.
 */
export async function resolveOwnHandle(): Promise<string | undefined> {
  if (cachedHandle) return cachedHandle;
  return withLock(async () => {
    if (cachedHandle) return cachedHandle;
    const page = await getPage();
    if (!page.url().includes(DOMAIN)) {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);
    }
    // The nav exposes several `/@handle` links; the profile tab points at *us*.
    // Prefer an <a> whose aria-label mentions "Profile", else the last such link.
    const handle = await page
      .evaluate(() => {
        // Runs in the browser; `document` is the page DOM, not Node's global.
        const doc = (globalThis as { document?: unknown }).document as {
          querySelectorAll: (s: string) => ArrayLike<{ getAttribute(n: string): string | null }>;
        };
        const anchors = Array.from(doc.querySelectorAll('a[href^="/@"]'));
        const profile = anchors.find((a) => /profile/i.test(a.getAttribute('aria-label') || ''));
        const pick = profile ?? anchors[anchors.length - 1];
        const m = pick?.getAttribute('href')?.match(/^\/@([A-Za-z0-9._]+)/);
        return m ? m[1] : undefined;
      })
      .catch(() => undefined);
    if (handle) cachedHandle = handle;
    return handle;
  });
}

/** Cleanly close the browser (used on shutdown / after login). */
export async function closeContext(): Promise<void> {
  if (contextPromise) {
    const ctx = await contextPromise;
    await ctx.close();
    contextPromise = null;
  }
}
