import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { threadsCapture, threadsUrl, profileUrl, normalizeHandle } from '../api/client.js';
import { BASE_URL, resolveOwnHandle, currentUserId, isLoggedIn } from '../browser/session.js';
import type { ThreadsUser } from '../api/types.js';
import { extractPosts, extractUser, extractUsers, extractActivity } from '../api/extract.js';
import { cache } from '../utils/cache.js';
import { withErrorHandling } from '../utils/errors.js';
import { renderPost, renderProfile, renderUserLine, renderNotification } from '../utils/format.js';
import { READ } from '../utils/annotations.js';
import {
  PostSchema,
  UserSchema,
  NotificationSchema,
  NOTIFICATION_KINDS,
  toPost,
  toUser,
  toNotification,
} from '../api/shape.js';
import type { TriggerContext } from '../browser/session.js';
import type { Page } from 'playwright';

/** Parse a Threads post URL → { handle, code }. Accepts a bare code too. */
export function parsePost(input: string): { handle?: string; code: string } | null {
  const m = input.match(/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)/);
  if (m) return { handle: m[1], code: m[2] };
  // Handle-less permalink, e.g. https://www.threads.com/post/ABC123 — Threads
  // serves these and they show up in shares, so recover the code rather than
  // falling through and losing it.
  const bare = input.match(/\/post\/([A-Za-z0-9_-]+)/);
  if (bare) return { code: bare[1] };
  // Bare shortcode (no handle) — still loadable via /post/<code>.
  if (/^[A-Za-z0-9_-]{6,}$/.test(input.trim())) return { code: input.trim() };
  return null;
}

/** Drop the logged-in user (leaks in from the nav chrome, not a real result). */
async function dropSelf(users: ThreadsUser[]): Promise<ThreadsUser[]> {
  const me = (await resolveOwnHandle())?.toLowerCase();
  return me ? users.filter((u) => u.username?.toLowerCase() !== me) : users;
}

/**
 * Scroll to make Threads load more items, at most `times` rounds.
 *
 * Three things end the loop early, in order of how often they fire:
 *   • `ctx.enough()` — we already have what the caller asked for;
 *   • no pagination request followed the scroll — the feed is exhausted, and
 *     scrolling a finished list just burns the remaining rounds;
 *   • the per-round cap, for a page that is simply slow.
 *
 * Waiting on the request rather than sleeping a flat 1.2s is what makes the
 * common case quick: pagination usually answers in a few hundred ms.
 */
async function scrollFeed(page: Page, times: number, ctx?: TriggerContext): Promise<void> {
  for (let i = 0; i < times; i++) {
    if (ctx?.enough()) return;
    await page.mouse.wheel(0, 2400);
    const paginated = await page
      .waitForResponse((r) => r.url().includes('graphql'), { timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (!paginated) return; // nothing more to load
    await page.waitForTimeout(200); // let the response body parse and render
  }
}

type Structured = Record<string, unknown>;
type Result = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Structured;
  isError?: boolean;
};

/**
 * An invalid-input result. Flagged `isError` for the same reason
 * withErrorHandling does it: a tool with an `outputSchema` must return matching
 * `structuredContent`, and `isError` is the documented exemption for the paths
 * that have no data to report.
 */
function badRequest(text: string): Result {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Text for humans, JSON for programs — the same answer in both forms.
 *
 * Clients that understand `structuredContent` get typed fields (a post's
 * `code`, its `url`) instead of having to pull them back out of rendered
 * markdown; clients that don't still get the text block, so this stays
 * backwards-compatible.
 */
function result(text: string, structured: Structured): Result {
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

/** Both halves of a cached answer — caching only the text would drop the JSON. */
interface Cached {
  text: string;
  structured: Structured;
}

/*
 * Note on scroll rounds: every feed-like surface gets a trigger, even for small
 * limits. It used to be gated on `limit > 8`, assuming the first render always
 * carries at least eight items — but search results arrive lazily, so a
 * `limit: 5` search skipped scrolling entirely and returned whatever single
 * result had landed. Handing the trigger over unconditionally is now free:
 * `triggerSkippable` drops it when the embedded payload already suffices, and
 * `scrollFeed` returns immediately once `ctx.enough()` is true.
 */

/**
 * "Stop as soon as we have `limit` posts." Passed to the capture layer so a
 * request that the server-rendered HTML already satisfies costs one page load
 * instead of a scroll loop plus a fixed multi-second dwell.
 */
function enoughPosts(limit: number): (bodies: unknown[]) => boolean {
  return (bodies) => extractPosts(bodies).length >= limit;
}

/** As above, for the user-shaped surfaces (search people, followers). */
function enoughUsers(limit: number): (bodies: unknown[]) => boolean {
  return (bodies) => extractUsers(bodies, limit + 8).length >= limit;
}

/**
 * Open a profile's Followers/Following dialog and scroll it.
 *
 * The follower count is clickable text (no anchor); clicking it fires
 * BarcelonaFriendshipsDialogUserQuery. The dialog opens on Followers, so
 * reaching Following means clicking that tab.
 *
 * Selecting the tab is the delicate part. Every *row* in the dialog also has a
 * "Following" button — that is the unfollow control — so a loose text match
 * would silently unfollow whoever happens to be first in the list. The tab is
 * therefore matched by `role="tab"`, and the text fallback requires the
 * follower count that only the tab carries ("Following 484"), never a bare
 * "Following".
 */
async function openFriendshipsDialog(
  page: Page,
  tab: 'followers' | 'following',
  limit: number,
  ctx?: TriggerContext,
): Promise<void> {
  await page.waitForTimeout(1500);
  const counts = page.getByText(/^[\d.,KMrb ]+ followers$/i).first();
  if (await counts.count()) await counts.click().catch(() => {});
  else
    await page
      .getByText(/followers/i)
      .first()
      .click()
      .catch(() => {});
  await page.waitForTimeout(2000);

  if (tab === 'following') {
    const dialog = page.locator('[role="dialog"]').last();
    let picked = false;
    const byRole = dialog.getByRole('tab', { name: /following/i }).first();
    if (await byRole.count().catch(() => 0)) {
      await byRole.click({ timeout: 5000 }).catch(() => {});
      picked = true;
    }
    if (!picked) {
      // Requires the trailing count, so this can only match the tab.
      const byText = dialog.getByText(/^Following\s*[\d.,KM]+$/i).first();
      if (await byText.count().catch(() => 0))
        await byText.click({ timeout: 5000 }).catch(() => {});
    }
    // Followers were already loaded when the dialog opened, and both lists are
    // plain user objects with nothing distinguishing them — so drop what we
    // have and count only what the Following tab sends.
    ctx?.reset();
    await page.waitForTimeout(2500);
  }

  for (let i = 0; i < Math.max(1, Math.ceil(limit / 12)); i++) {
    if (ctx?.enough()) return;
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(900);
  }
}

export function registerReadTools(server: McpServer): void {
  // ── whoami ─────────────────────────────────────────────────────────────────────
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Show which Threads account this server is signed in as (your @handle, user id, name, follower/following counts). ' +
        'Use this to confirm the active session before posting.',
      inputSchema: {},
      outputSchema: { profile: UserSchema.optional(), signed_in: z.boolean() },
      annotations: READ,
    },
    async () => {
      return withErrorHandling(async () => {
        if (!(await isLoggedIn())) {
          return {
            content: [
              {
                type: 'text',
                text: '🔒 Not signed in. Run `npm run login` (or `threads-mcp-login`) to authenticate.',
              },
            ],
            structuredContent: { signed_in: false },
          };
        }
        const handle = await resolveOwnHandle();
        const uid = await currentUserId();
        if (!handle) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `✅ Signed in${uid ? ` (user id: \`${uid}\`)` : ''}, but couldn't resolve your @handle. ` +
                  'The session is valid; try a tool, or re-run `npm run login`.',
              },
            ],
            structuredContent: { signed_in: true },
          };
        }
        const bodies = await threadsCapture(profileUrl(handle), 'ProfileThreadsTab');
        const me = extractUser(bodies, handle);
        const header = me ? renderProfile(me) : `🧵 **@${handle}**${uid ? `\nid: \`${uid}\`` : ''}`;
        return result(`👤 Signed in as:\n\n${header}`, {
          signed_in: true,
          profile: me ? toUser(me) : { handle, id: uid, verified: false },
        });
      });
    },
  );

  // ── get_profile ──────────────────────────────────────────────────────────────
  server.registerTool(
    'get_profile',
    {
      title: 'Get profile',
      description:
        "Get a Threads user's profile: display name, bio, follower count, verified status, and a few recent posts. " +
        'Omit `handle` to get your own profile.',
      inputSchema: {
        handle: z
          .string()
          .optional()
          .describe('The @username (with or without @). Omit for your own profile.'),
      },
      outputSchema: { profile: UserSchema, recent_posts: z.array(PostSchema) },
      annotations: READ,
    },
    async ({ handle }) => {
      return withErrorHandling(async () => {
        const user = handle ? normalizeHandle(handle) : await resolveOwnHandle();
        if (!user) {
          return badRequest(
            '❌ Could not determine your own handle. Pass `handle` explicitly, or re-run `npm run login`.',
          );
        }

        const cacheKey = cache.key('profile', user);
        const cached = cache.get<Cached>(cacheKey);
        if (cached) return result(cached.text, cached.structured);

        const bodies = await threadsCapture(profileUrl(user), 'ProfileThreadsTab');
        const profile = extractUser(bodies, user);
        if (!profile) {
          return badRequest(
            `❌ Couldn't read @${user}'s profile. The account may be private, blocked, or nonexistent.`,
          );
        }

        const posts = extractPosts(bodies)
          .filter((p) => p.user?.username?.toLowerCase() === user)
          .slice(0, 5);
        const parts = [renderProfile(profile)];
        if (posts.length) {
          parts.push('', '— Recent —', ...posts.map((p, i) => renderPost(p, { index: i + 1 })));
        }
        const text = parts.join('\n');
        const structured = { profile: toUser(profile), recent_posts: posts.map(toPost) };
        cache.set(cacheKey, { text, structured });
        return result(text, structured);
      });
    },
  );

  // ── get_user_threads ─────────────────────────────────────────────────────────
  server.registerTool(
    'get_user_threads',
    {
      title: 'Get user posts',
      description: "Get a user's recent Threads posts (their profile feed).",
      inputSchema: {
        handle: z.string().describe('The @username whose posts to fetch'),
        limit: z.number().int().min(1).max(50).default(15).describe('Max posts (1-50, default 15)'),
      },
      outputSchema: { posts: z.array(PostSchema) },
      annotations: READ,
    },
    async ({ handle, limit }) => {
      return withErrorHandling(async () => {
        const user = normalizeHandle(handle);
        const cacheKey = cache.key('user_threads', user, limit);
        const cached = cache.get<Cached>(cacheKey);
        if (cached) return result(cached.text, cached.structured);

        const bodies = await threadsCapture(profileUrl(user), 'ProfileThreadsTab', {
          trigger: (p, ctx) => scrollFeed(p, Math.max(1, Math.ceil(limit / 8)), ctx),
          triggerSkippable: true, // scrolling just fetches more of the same posts
          dwellMs: 4000,
          // Count only this user's posts: a profile page also embeds
          // recommendation rails, which would otherwise satisfy the check early.
          enough: (b) =>
            extractPosts(b).filter((p) => p.user?.username?.toLowerCase() === user).length >= limit,
        });
        const posts = extractPosts(bodies)
          .filter((p) => p.user?.username?.toLowerCase() === user)
          .slice(0, limit);
        if (posts.length === 0) {
          return result(`No posts found for @${user}.`, { posts: [] });
        }
        const text = [
          `🧵 Posts by @${user}`,
          '',
          ...posts.map((p, i) => renderPost(p, { index: i + 1 })),
        ].join('\n\n');
        const structured = { posts: posts.map(toPost) };
        cache.set(cacheKey, { text, structured });
        return result(text, structured);
      });
    },
  );

  // ── get_thread ────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_thread',
    {
      title: 'Get a post',
      description:
        'Get a single Threads post with its stats. Provide the post `url`, or `handle` + `code`.',
      inputSchema: {
        url: z
          .string()
          .optional()
          .describe('Full post URL, e.g. https://www.threads.com/@user/post/ABC123'),
        handle: z.string().optional().describe('Author @username (if not using url)'),
        code: z.string().optional().describe('Post shortcode (if not using url)'),
      },
      outputSchema: { post: PostSchema.optional() },
      annotations: READ,
    },
    async ({ url, handle, code }) => {
      return withErrorHandling(async () => {
        const parsed = resolvePostTarget(url, handle, code);
        if (!parsed) {
          return badRequest('❌ Provide a post `url`, or `handle` + `code`.');
        }
        const cacheKey = cache.key('thread', parsed.pageUrl);
        const cached = cache.get<Cached>(cacheKey);
        if (cached) return result(cached.text, cached.structured);

        const bodies = await threadsCapture(parsed.pageUrl, 'PostPage', {
          dwellMs: 3500,
          enough: enoughPosts(1),
        });
        const posts = extractPosts(bodies);
        const root =
          posts.find((p) => p.code === parsed.code) ??
          posts.find((p) => !p.text_post_app_info?.is_reply) ??
          posts[0];
        if (!root) {
          return badRequest('❌ Could not read that post. Check the URL/code.');
        }
        const text = renderPost(root);
        const structured = { post: toPost(root) };
        cache.set(cacheKey, { text, structured });
        return result(text, structured);
      });
    },
  );

  // ── get_thread_replies ─────────────────────────────────────────────────────────
  server.registerTool(
    'get_thread_replies',
    {
      title: 'Get post replies',
      description:
        'Get the replies to a Threads post. Provide the post `url`, or `handle` + `code`.',
      inputSchema: {
        url: z.string().optional().describe('Full post URL'),
        handle: z.string().optional().describe('Author @username (if not using url)'),
        code: z.string().optional().describe('Post shortcode (if not using url)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(15)
          .describe('Max replies (1-50, default 15)'),
      },
      outputSchema: { replies: z.array(PostSchema) },
      annotations: READ,
    },
    async ({ url, handle, code, limit }) => {
      return withErrorHandling(async () => {
        const parsed = resolvePostTarget(url, handle, code);
        if (!parsed) {
          return badRequest('❌ Provide a post `url`, or `handle` + `code`.');
        }
        const bodies = await threadsCapture(parsed.pageUrl, 'PostPage', {
          trigger: (p, ctx) => scrollFeed(p, Math.ceil(limit / 8), ctx),
          triggerSkippable: true, // scrolling just fetches more replies
          dwellMs: 4000,
          // +1 for the root post, which isn't a reply.
          enough: enoughPosts(limit + 1),
        });
        const all = extractPosts(bodies);
        // Identify the root post so it isn't reported as a reply to itself.
        // Filtering on `p.code !== parsed.code` alone breaks when the caller
        // passed a URL we couldn't parse a code out of: every post then
        // compares unequal to `undefined` and the root survives the filter.
        // Fall back to the first non-reply (the heuristic get_thread uses),
        // then to document order, and compare by identity so a missing code
        // can never make the comparison vacuously true.
        const root =
          (parsed.code ? all.find((p) => p.code === parsed.code) : undefined) ??
          all.find((p) => !p.text_post_app_info?.is_reply) ??
          all[0];
        const replies = all.filter((p) => p !== root).slice(0, limit);
        if (replies.length === 0) {
          return {
            content: [{ type: 'text', text: 'No replies found (or replies are restricted).' }],
            structuredContent: { replies: [] },
          };
        }
        const text = [
          `💬 Replies`,
          '',
          ...replies.map((p, i) => renderPost(p, { index: i + 1 })),
        ].join('\n\n');
        return result(text, { replies: replies.map(toPost) });
      });
    },
  );

  // ── get_timeline ───────────────────────────────────────────────────────────────
  server.registerTool(
    'get_timeline',
    {
      title: 'Get home timeline',
      description: 'Get your Threads home feed (the "For you" timeline).',
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(15).describe('Max posts (1-50, default 15)'),
      },
      outputSchema: { posts: z.array(PostSchema) },
      annotations: READ,
    },
    async ({ limit }) => {
      return withErrorHandling(async () => {
        const cacheKey = cache.key('timeline', limit);
        const cached = cache.get<Cached>(cacheKey);
        if (cached) return result(cached.text, cached.structured);

        const bodies = await threadsCapture(`${BASE_URL}/`, 'FeedDirect', {
          trigger: (p, ctx) => scrollFeed(p, Math.max(1, Math.ceil(limit / 8)), ctx),
          triggerSkippable: true, // scrolling just fetches more of the same posts
          dwellMs: 5000,
          enough: enoughPosts(limit),
        });
        const posts = extractPosts(bodies).slice(0, limit);
        if (posts.length === 0) {
          return {
            content: [{ type: 'text', text: 'Timeline came back empty. Try again in a moment.' }],
            structuredContent: { posts: [] },
          };
        }
        const text = [
          `🏠 Home timeline`,
          '',
          ...posts.map((p, i) => renderPost(p, { index: i + 1 })),
        ].join('\n\n');
        const structured = { posts: posts.map(toPost) };
        cache.set(cacheKey, { text, structured });
        return result(text, structured);
      });
    },
  );

  // ── search ─────────────────────────────────────────────────────────────────────
  server.registerTool(
    'search',
    {
      title: 'Search Threads',
      description: 'Search Threads for posts or users matching a query.',
      inputSchema: {
        query: z.string().min(1).describe('The search text'),
        type: z
          .enum(['posts', 'users'])
          .default('posts')
          .describe('What to search for (default: posts)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(15)
          .describe('Max results (1-50, default 15)'),
      },
      // One schema covers both modes: `type` decides which key is populated,
      // and outputSchema is static per tool.
      outputSchema: {
        posts: z.array(PostSchema).optional(),
        users: z.array(UserSchema).optional(),
      },
      annotations: READ,
    },
    async ({ query, type, limit }) => {
      return withErrorHandling(async () => {
        const cacheKey = cache.key('search', type, query.toLowerCase(), limit);
        const cached = cache.get<Cached>(cacheKey);
        if (cached) return result(cached.text, cached.structured);

        const q = encodeURIComponent(query);
        const filter = type === 'users' ? '&serp_type=default' : '';
        const searchUrl = threadsUrl(`/search?q=${q}${filter}`);
        const bodies = await threadsCapture(searchUrl, 'Search', {
          trigger: (p, ctx) => scrollFeed(p, Math.max(1, Math.ceil(limit / 8)), ctx),
          triggerSkippable: true, // scrolling just fetches more of the same posts
          dwellMs: 4000,
          enough: type === 'users' ? enoughUsers(limit) : enoughPosts(limit),
        });

        if (type === 'users') {
          const users = (await dropSelf(extractUsers(bodies, limit + 3))).slice(0, limit);
          if (users.length === 0) return result(`No users found for "${query}".`, { users: [] });
          const text = [
            `🔎 Users matching "${query}"`,
            '',
            ...users.map((u, i) => renderUserLine(u, i + 1)),
          ].join('\n');
          const structured = { users: users.map(toUser) };
          cache.set(cacheKey, { text, structured });
          return result(text, structured);
        }

        const posts = extractPosts(bodies).slice(0, limit);
        if (posts.length === 0) return result(`No posts found for "${query}".`, { posts: [] });
        const text = [
          `🔎 Posts matching "${query}"`,
          '',
          ...posts.map((p, i) => renderPost(p, { index: i + 1 })),
        ].join('\n\n');
        const structured = { posts: posts.map(toPost) };
        cache.set(cacheKey, { text, structured });
        return result(text, structured);
      });
    },
  );

  // ── get_notifications ────────────────────────────────────────────────────────
  server.registerTool(
    'get_notifications',
    {
      title: 'Get notifications',
      description:
        'Read your Threads Activity feed — who followed you, replies and mentions, and suggestions. ' +
        'This is how you find out what happened on your account; every other read tool looks outward. ' +
        'Optionally filter by `kind`.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Max entries (1-100, default 20)'),
        kind: z
          .enum(NOTIFICATION_KINDS)
          .optional()
          .describe(
            'Only return this category. Filtering happens after fetching, because Threads ' +
              'drives its Activity tabs from a popover rather than the URL.',
          ),
      },
      outputSchema: { notifications: z.array(NotificationSchema) },
      annotations: READ,
    },
    async ({ limit, kind }) => {
      return withErrorHandling(async () => {
        const cacheKey = cache.key('activity', limit, kind);
        const cached = cache.get<Cached>(cacheKey);
        if (cached) return result(cached.text, cached.structured);

        const bodies = await threadsCapture(threadsUrl('/activity'), 'ActivityFeed', {
          trigger: (p, ctx) => scrollFeed(p, Math.max(1, Math.ceil(limit / 12)), ctx),
          triggerSkippable: true,
          dwellMs: 4500,
          // Count before filtering: a `kind` filter would otherwise keep us
          // scrolling for entries of a type this account may never receive.
          enough: (b) => extractActivity(b).length >= limit,
        });

        const all = extractActivity(bodies).map(toNotification);
        const items = (kind ? all.filter((n) => n.kind === kind) : all).slice(0, limit);
        if (items.length === 0) {
          return result(kind ? `No "${kind}" activity found.` : 'No activity found.', {
            notifications: [],
          });
        }
        const text = [
          `🔔 Activity${kind ? ` (${kind})` : ''}`,
          '',
          ...items.map((n, i) => renderNotification(n, i + 1)),
        ].join('\n');
        const structured = { notifications: items };
        cache.set(cacheKey, { text, structured });
        return result(text, structured);
      });
    },
  );

  // ── get_followers ────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_followers',
    {
      title: 'Get followers',
      description:
        "Get a sample of a user's followers (opens the followers list and reads what loads). " +
        'Threads does not expose a full follower dump; expect a partial list.',
      inputSchema: {
        handle: z.string().describe('The @username whose followers to list'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(30)
          .describe('Max followers (1-100, default 30)'),
      },
      outputSchema: { users: z.array(UserSchema) },
      annotations: READ,
    },
    async ({ handle, limit }) => {
      return withErrorHandling(async () => {
        const user = normalizeHandle(handle);
        const bodies = await threadsCapture(profileUrl(user), 'FriendshipsDialogUser', {
          // The follower list is never server-rendered — it only arrives once
          // the dialog opens — so the trigger always has to run here. The
          // predicate still cuts the in-dialog scrolling short once we have
          // enough rows.
          enough: enoughUsers(limit),
          trigger: (p, ctx) => openFriendshipsDialog(p, 'followers', limit, ctx),
          dwellMs: 4500,
        });
        // Exclude the profile owner and the logged-in user; keep real followers.
        const users = (await dropSelf(extractUsers(bodies, limit + 8)))
          .filter((u) => u.username?.toLowerCase() !== user)
          .slice(0, limit);
        if (users.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Couldn't read @${user}'s followers (private account, or the list didn't load).`,
              },
            ],
            structuredContent: { users: [] },
          };
        }
        const text = [
          `👥 Followers of @${user} (partial sample, ${users.length})`,
          '',
          ...users.map((u, i) => renderUserLine(u, i + 1)),
        ].join('\n');
        return result(text, { users: users.map(toUser) });
      });
    },
  );

  // ── get_following ────────────────────────────────────────────────────────────
  server.registerTool(
    'get_following',
    {
      title: 'Get following',
      description:
        'Get a sample of the accounts a user follows (opens their Following list and reads what loads). ' +
        'Threads does not expose a full dump; expect a partial list.',
      inputSchema: {
        handle: z.string().describe('The @username whose following list to read'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(30)
          .describe('Max accounts (1-100, default 30)'),
      },
      outputSchema: { users: z.array(UserSchema) },
      annotations: READ,
    },
    async ({ handle, limit }) => {
      return withErrorHandling(async () => {
        const user = normalizeHandle(handle);
        const bodies = await threadsCapture(profileUrl(user), 'FriendshipsDialogUser', {
          // Same reasoning as get_followers: the list only exists once the
          // dialog is open, so the trigger is never skippable.
          enough: enoughUsers(limit),
          trigger: (p, ctx) => openFriendshipsDialog(p, 'following', limit, ctx),
          dwellMs: 4500,
        });
        const users = (await dropSelf(extractUsers(bodies, limit + 8)))
          .filter((u) => u.username?.toLowerCase() !== user)
          .slice(0, limit);
        if (users.length === 0) {
          return result(
            `Couldn't read who @${user} follows (private account, or the list didn't load).`,
            { users: [] },
          );
        }
        const text = [
          `👣 @${user} follows (partial sample, ${users.length})`,
          '',
          ...users.map((u, i) => renderUserLine(u, i + 1)),
        ].join('\n');
        return result(text, { users: users.map(toUser) });
      });
    },
  );
}

/** Resolve a post target from url OR handle+code into a page URL + code. */
function resolvePostTarget(
  url?: string,
  handle?: string,
  code?: string,
): { pageUrl: string; code?: string } | null {
  if (url) {
    const p = parsePost(url);
    if (p) {
      return {
        pageUrl: p.handle
          ? threadsUrl(`/@${p.handle}/post/${p.code}`)
          : threadsUrl(`/post/${p.code}`),
        code: p.code,
      };
    }
    // A full URL we didn't recognize — just load it.
    return { pageUrl: url };
  }
  if (code) {
    return {
      pageUrl: handle
        ? threadsUrl(`/@${normalizeHandle(handle)}/post/${code}`)
        : threadsUrl(`/post/${code}`),
      code,
    };
  }
  return null;
}
