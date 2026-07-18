import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { threadsCapture, threadsUrl, profileUrl, normalizeHandle } from '../api/client.js';
import { BASE_URL, resolveOwnHandle, currentUserId, isLoggedIn } from '../browser/session.js';
import type { ThreadsUser } from '../api/types.js';
import { extractPosts, extractUser, extractUsers } from '../api/extract.js';
import { cache } from '../utils/cache.js';
import { withErrorHandling } from '../utils/errors.js';
import { renderPost, renderProfile, renderUserLine } from '../utils/format.js';
import type { Page } from 'playwright';

/** Parse a Threads post URL → { handle, code }. Accepts a bare code too. */
function parsePost(input: string): { handle?: string; code: string } | null {
  const m = input.match(/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)/);
  if (m) return { handle: m[1], code: m[2] };
  // Bare shortcode (no handle) — still loadable via /post/<code>.
  if (/^[A-Za-z0-9_-]{6,}$/.test(input.trim())) return { code: input.trim() };
  return null;
}

/** Drop the logged-in user (leaks in from the nav chrome, not a real result). */
async function dropSelf(users: ThreadsUser[]): Promise<ThreadsUser[]> {
  const me = (await resolveOwnHandle())?.toLowerCase();
  return me ? users.filter((u) => u.username?.toLowerCase() !== me) : users;
}

/** Scroll the page a few times to make Threads load more items. */
async function scrollFeed(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(1200);
  }
}

export function registerReadTools(server: McpServer): void {
  // ── whoami ─────────────────────────────────────────────────────────────────────
  server.tool(
    'whoami',
    'Show which Threads account this server is signed in as (your @handle, user id, name, follower/following counts). ' +
      'Use this to confirm the active session before posting.',
    {},
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
          };
        }
        const bodies = await threadsCapture(profileUrl(handle), 'ProfileThreadsTab');
        const me = extractUser(bodies, handle);
        const header = me ? renderProfile(me) : `🧵 **@${handle}**${uid ? `\nid: \`${uid}\`` : ''}`;
        return { content: [{ type: 'text', text: `👤 Signed in as:\n\n${header}` }] };
      });
    },
  );

  // ── get_profile ──────────────────────────────────────────────────────────────
  server.tool(
    'get_profile',
    "Get a Threads user's profile: display name, bio, follower count, verified status, and a few recent posts. " +
      'Omit `handle` to get your own profile.',
    {
      handle: z
        .string()
        .optional()
        .describe('The @username (with or without @). Omit for your own profile.'),
    },
    async ({ handle }) => {
      return withErrorHandling(async () => {
        const user = handle ? normalizeHandle(handle) : await resolveOwnHandle();
        if (!user) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ Could not determine your own handle. Pass `handle` explicitly, or re-run `npm run login`.',
              },
            ],
          };
        }

        const cacheKey = cache.key('profile', user);
        const cached = cache.get<string>(cacheKey);
        if (cached) return { content: [{ type: 'text', text: cached }] };

        const bodies = await threadsCapture(profileUrl(user), 'ProfileThreadsTab');
        const profile = extractUser(bodies, user);
        if (!profile) {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Couldn't read @${user}'s profile. The account may be private, blocked, or nonexistent.`,
              },
            ],
          };
        }

        const posts = extractPosts(bodies)
          .filter((p) => p.user?.username?.toLowerCase() === user)
          .slice(0, 5);
        const parts = [renderProfile(profile)];
        if (posts.length) {
          parts.push('', '— Recent —', ...posts.map((p, i) => renderPost(p, { index: i + 1 })));
        }
        const text = parts.join('\n');
        cache.set(cacheKey, text);
        return { content: [{ type: 'text', text }] };
      });
    },
  );

  // ── get_user_threads ─────────────────────────────────────────────────────────
  server.tool(
    'get_user_threads',
    "Get a user's recent Threads posts (their profile feed).",
    {
      handle: z.string().describe('The @username whose posts to fetch'),
      limit: z.number().int().min(1).max(50).default(15).describe('Max posts (1-50, default 15)'),
    },
    async ({ handle, limit }) => {
      return withErrorHandling(async () => {
        const user = normalizeHandle(handle);
        const bodies = await threadsCapture(profileUrl(user), 'ProfileThreadsTab', {
          trigger: limit > 8 ? (p) => scrollFeed(p, Math.ceil(limit / 8)) : undefined,
          dwellMs: 4000,
        });
        const posts = extractPosts(bodies)
          .filter((p) => p.user?.username?.toLowerCase() === user)
          .slice(0, limit);
        if (posts.length === 0) {
          return { content: [{ type: 'text', text: `No posts found for @${user}.` }] };
        }
        const text = [
          `🧵 Posts by @${user}`,
          '',
          ...posts.map((p, i) => renderPost(p, { index: i + 1 })),
        ].join('\n\n');
        return { content: [{ type: 'text', text }] };
      });
    },
  );

  // ── get_thread ────────────────────────────────────────────────────────────────
  server.tool(
    'get_thread',
    'Get a single Threads post with its stats. Provide the post `url`, or `handle` + `code`.',
    {
      url: z
        .string()
        .optional()
        .describe('Full post URL, e.g. https://www.threads.com/@user/post/ABC123'),
      handle: z.string().optional().describe('Author @username (if not using url)'),
      code: z.string().optional().describe('Post shortcode (if not using url)'),
    },
    async ({ url, handle, code }) => {
      return withErrorHandling(async () => {
        const parsed = resolvePostTarget(url, handle, code);
        if (!parsed) {
          return {
            content: [{ type: 'text', text: '❌ Provide a post `url`, or `handle` + `code`.' }],
          };
        }
        const bodies = await threadsCapture(parsed.pageUrl, 'PostPage', { dwellMs: 3500 });
        const posts = extractPosts(bodies);
        const root =
          posts.find((p) => p.code === parsed.code) ??
          posts.find((p) => !p.text_post_app_info?.is_reply) ??
          posts[0];
        if (!root) {
          return {
            content: [{ type: 'text', text: '❌ Could not read that post. Check the URL/code.' }],
          };
        }
        return { content: [{ type: 'text', text: renderPost(root) }] };
      });
    },
  );

  // ── get_thread_replies ─────────────────────────────────────────────────────────
  server.tool(
    'get_thread_replies',
    'Get the replies to a Threads post. Provide the post `url`, or `handle` + `code`.',
    {
      url: z.string().optional().describe('Full post URL'),
      handle: z.string().optional().describe('Author @username (if not using url)'),
      code: z.string().optional().describe('Post shortcode (if not using url)'),
      limit: z.number().int().min(1).max(50).default(15).describe('Max replies (1-50, default 15)'),
    },
    async ({ url, handle, code, limit }) => {
      return withErrorHandling(async () => {
        const parsed = resolvePostTarget(url, handle, code);
        if (!parsed) {
          return {
            content: [{ type: 'text', text: '❌ Provide a post `url`, or `handle` + `code`.' }],
          };
        }
        const bodies = await threadsCapture(parsed.pageUrl, 'PostPage', {
          trigger: (p) => scrollFeed(p, Math.ceil(limit / 8)),
          dwellMs: 4000,
        });
        const all = extractPosts(bodies);
        const replies = all.filter((p) => p.code !== parsed.code).slice(0, limit);
        if (replies.length === 0) {
          return {
            content: [{ type: 'text', text: 'No replies found (or replies are restricted).' }],
          };
        }
        const text = [
          `💬 Replies`,
          '',
          ...replies.map((p, i) => renderPost(p, { index: i + 1 })),
        ].join('\n\n');
        return { content: [{ type: 'text', text }] };
      });
    },
  );

  // ── get_timeline ───────────────────────────────────────────────────────────────
  server.tool(
    'get_timeline',
    'Get your Threads home feed (the "For you" timeline).',
    {
      limit: z.number().int().min(1).max(50).default(15).describe('Max posts (1-50, default 15)'),
    },
    async ({ limit }) => {
      return withErrorHandling(async () => {
        const bodies = await threadsCapture(`${BASE_URL}/`, 'FeedDirect', {
          trigger: limit > 8 ? (p) => scrollFeed(p, Math.ceil(limit / 8)) : undefined,
          dwellMs: 5000,
        });
        const posts = extractPosts(bodies).slice(0, limit);
        if (posts.length === 0) {
          return {
            content: [{ type: 'text', text: 'Timeline came back empty. Try again in a moment.' }],
          };
        }
        const text = [
          `🏠 Home timeline`,
          '',
          ...posts.map((p, i) => renderPost(p, { index: i + 1 })),
        ].join('\n\n');
        return { content: [{ type: 'text', text }] };
      });
    },
  );

  // ── search ─────────────────────────────────────────────────────────────────────
  server.tool(
    'search',
    'Search Threads for posts or users matching a query.',
    {
      query: z.string().min(1).describe('The search text'),
      type: z
        .enum(['posts', 'users'])
        .default('posts')
        .describe('What to search for (default: posts)'),
      limit: z.number().int().min(1).max(50).default(15).describe('Max results (1-50, default 15)'),
    },
    async ({ query, type, limit }) => {
      return withErrorHandling(async () => {
        const q = encodeURIComponent(query);
        const filter = type === 'users' ? '&serp_type=default' : '';
        const searchUrl = threadsUrl(`/search?q=${q}${filter}`);
        const bodies = await threadsCapture(searchUrl, 'Search', {
          trigger: limit > 8 ? (p) => scrollFeed(p, Math.ceil(limit / 8)) : undefined,
          dwellMs: 4000,
        });

        if (type === 'users') {
          const users = (await dropSelf(extractUsers(bodies, limit + 3))).slice(0, limit);
          if (users.length === 0)
            return { content: [{ type: 'text', text: `No users found for "${query}".` }] };
          const text = [
            `🔎 Users matching "${query}"`,
            '',
            ...users.map((u, i) => renderUserLine(u, i + 1)),
          ].join('\n');
          return { content: [{ type: 'text', text }] };
        }

        const posts = extractPosts(bodies).slice(0, limit);
        if (posts.length === 0)
          return { content: [{ type: 'text', text: `No posts found for "${query}".` }] };
        const text = [
          `🔎 Posts matching "${query}"`,
          '',
          ...posts.map((p, i) => renderPost(p, { index: i + 1 })),
        ].join('\n\n');
        return { content: [{ type: 'text', text }] };
      });
    },
  );

  // ── get_followers ────────────────────────────────────────────────────────────────
  server.tool(
    'get_followers',
    "Get a sample of a user's followers (opens the followers list and reads what loads). " +
      'Threads does not expose a full follower dump; expect a partial list.',
    {
      handle: z.string().describe('The @username whose followers to list'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(30)
        .describe('Max followers (1-100, default 30)'),
    },
    async ({ handle, limit }) => {
      return withErrorHandling(async () => {
        const user = normalizeHandle(handle);
        const bodies = await threadsCapture(profileUrl(user), 'FriendshipsDialogUser', {
          trigger: async (p) => {
            // The follower count is a clickable text (no anchor) that opens a
            // dialog; clicking it fires BarcelonaFriendshipsDialogUserQuery.
            await p.waitForTimeout(1500);
            const trigger = p.getByText(/^[\d.,KMrb ]+ followers$/i).first();
            if (await trigger.count()) {
              await trigger.click().catch(() => {});
            } else {
              await p
                .getByText(/followers/i)
                .first()
                .click()
                .catch(() => {});
            }
            await p.waitForTimeout(2000);
            // Scroll inside the dialog to load more rows.
            for (let i = 0; i < Math.ceil(limit / 12); i++) {
              await p.mouse.wheel(0, 1000);
              await p.waitForTimeout(900);
            }
          },
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
          };
        }
        const text = [
          `👥 Followers of @${user} (partial sample, ${users.length})`,
          '',
          ...users.map((u, i) => renderUserLine(u, i + 1)),
        ].join('\n');
        return { content: [{ type: 'text', text }] };
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
