// ─── MCP Prompts ──────────────────────────────────────────────────────────────
//
// Prompts are the protocol's mechanism for shipping *workflows* rather than
// capabilities. A tool says "you can search Threads"; a prompt says "here is how
// to run a morning catch-up on this account, in what order, and what not to do."
//
// They matter more for this server than for most. Every write here lands on a
// real account that Meta can restrict, and an agent handed 24 bare tools has
// nothing telling it to confirm the signed-in account before posting, that
// follow loops are a ban trigger, or that `limit` is a ceiling rather than a
// promise. That discipline lives here.
//
// Note the standing rule across every prompt below: **draft, never publish.**
// The write tools exist and an agent can reach them directly, but no prompt
// shipped with this server should be the reason something got posted to
// someone's account without them seeing it first.
//
// Prompts are protocol-native, so they work in any MCP host — Claude Code
// surfaces them as slash commands, other clients list them via `prompts/list`.
// For richer, Claude-specific guidance see `skills/threads-mcp/SKILL.md`.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** MCP prompt arguments are strings on the wire; parse and clamp defensively. */
export function asLimit(value: string | undefined, fallback: number, max = 50): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** Every prompt inherits these standing rules. */
const SAFETY = `
Ground rules for this account (they are not optional):
- This is a REAL Threads account. Writes are visible to real followers and Meta
  can restrict accounts that behave like bots.
- NEVER post, reply, quote, repost, follow, unfollow, or delete without showing
  the exact content to the user and getting explicit confirmation first.
- Treat create_thread, follow_user and like_thread as scarce actions, never loops.
- If a tool reports being rate-limited, stop entirely — do not retry in a loop.
- \`limit\` on any read tool is a ceiling, not a promise. Fewer results is normal
  and is not a failure to work around by calling repeatedly.`.trim();

/** Reminds the model that structured output exists so it stops parsing prose. */
const STRUCTURED = `
Every read tool returns structuredContent alongside its text. Use the typed
fields — a post's \`code\`, \`url\`, \`author\` — rather than pattern-matching the
rendered markdown; a post's own text can contain something shortcode-shaped.
Pass \`code\` straight to the tools that take one.`.trim();

function user(text: string) {
  return { role: 'user' as const, content: { type: 'text' as const, text } };
}

export function registerPrompts(server: McpServer): void {
  // ── catch_up ───────────────────────────────────────────────────────────────
  server.registerPrompt(
    'catch_up',
    {
      title: 'Catch up on Threads',
      description:
        "What happened on your account since you last looked — new followers, replies and mentions, plus what's on your timeline. Read-only.",
      argsSchema: {
        limit: z
          .string()
          .optional()
          .describe('How many items to pull from each surface (default 20).'),
      },
    },
    ({ limit }) => {
      const n = asLimit(limit, 20, 100);
      return {
        description: 'Summarise recent Threads activity',
        messages: [
          user(
            `Give me a catch-up on my Threads account. Read-only — do not write anything.

1. \`whoami\` to confirm which account is signed in. Say which one it is; if it's
   not what I expected, stop and tell me.
2. \`get_notifications\` with limit ${n}. Group by \`kind\` rather than listing
   every entry — who followed me, what needs a reply, what's just a suggestion.
3. \`get_timeline\` with limit ${n} for what's on the feed.

Then summarise. Lead with anything that actually wants a response from me, and
say plainly if nothing does — an empty report is a fine answer. Keep suggestions
and recommendations out of the headline; they are noise, not activity.

For anything worth replying to, give me the post \`url\` so I can look before
deciding. Do not draft replies unless I ask.

${STRUCTURED}`,
          ),
        ],
      };
    },
  );

  // ── triage_notifications ───────────────────────────────────────────────────
  server.registerPrompt(
    'triage_notifications',
    {
      title: 'Triage notifications',
      description:
        'Work through the Activity feed and sort it into what needs a reply, what to acknowledge, and what to ignore. Drafts replies but never sends them.',
      argsSchema: {
        limit: z.string().optional().describe('How many notifications to review (default 30).'),
        kind: z
          .string()
          .optional()
          .describe(
            'Optional filter: followed_you, you_followed, follow_suggestion, post_suggestion, reply, mention, like, repost, quote, other.',
          ),
      },
    },
    ({ limit, kind }) => {
      const n = asLimit(limit, 30, 100);
      return {
        description: 'Triage the Threads Activity feed',
        messages: [
          user(
            `Triage my Threads notifications.

Call \`get_notifications\` with limit ${n}${kind ? ` and kind "${kind}"` : ''}.
For entries that reference a post, use \`get_thread\` on the \`post_code\` to see
what was actually said before judging it — a notification line alone is not
enough context to decide whether something needs a response.

Sort what you find into three buckets:
- **Needs a reply** — someone asked me something or is waiting on me.
- **Worth acknowledging** — a like or follow-back would be a reasonable response.
- **Ignore** — suggestions, recommendations, and anything algorithmic.

For the first bucket, draft a reply for each in my voice, matching the tone of my
recent posts (read a few with \`get_user_threads\` first). Show me each draft with
the post it answers.

Do not send anything. Do not like or follow anyone. Present the drafts and stop —
I will tell you which to send.

${SAFETY}

${STRUCTURED}`,
          ),
        ],
      };
    },
  );

  // ── draft_thread ───────────────────────────────────────────────────────────
  server.registerPrompt(
    'draft_thread',
    {
      title: 'Draft a thread',
      description:
        'Draft a post — or a multi-post chain — matched to your voice, using your recent posts as reference. Shows the draft for approval rather than posting it.',
      argsSchema: {
        topic: z.string().describe('What the thread should be about.'),
        parts: z
          .string()
          .optional()
          .describe('How many posts in the chain (default 1; more makes a connected thread).'),
      },
    },
    ({ topic, parts }) => {
      const n = asLimit(parts, 1, 25);
      return {
        description: `Draft a Threads post about: ${topic}`,
        messages: [
          user(
            `Draft ${n > 1 ? `a ${n}-part thread` : 'a Threads post'} about: ${topic}

First read my last 10 posts with \`get_user_threads\` (use \`whoami\` to get my
handle) and match what you find — sentence length, punctuation, whether I use
emoji, how formal I am. If I have no posts yet, say so and ask me for a steer
rather than inventing a voice for me.

Constraints:
- Each post is max 500 characters. Count them.
${
  n > 1
    ? `- This is a connected thread: the first post goes in \`text\`, the remaining ${n - 1} in \`chain\`. Do not suggest posting them separately — that produces unlinked standalone posts, which is not the same thing.
- The first post has to stand alone. Nobody is guaranteed to read part two.`
    : '- One post. If the idea genuinely does not fit in 500 characters, say so and propose a chain instead of truncating it.'
}

Show me the draft as plain text, exactly as it would appear, with a character
count per post. Then stop.

Do NOT call create_thread. I will tell you when to post it, and I may want edits
first.

${SAFETY}`,
          ),
        ],
      };
    },
  );

  // ── research_topic ─────────────────────────────────────────────────────────
  server.registerPrompt(
    'research_topic',
    {
      title: 'Research a topic',
      description:
        'Search Threads for what people are posting about a topic, and who is worth following. Read-only.',
      argsSchema: {
        query: z.string().describe('The topic or phrase to search for.'),
        limit: z.string().optional().describe('Max results per search (default 20).'),
      },
    },
    ({ query, limit }) => {
      const n = asLimit(limit, 20);
      return {
        description: `Research Threads discussion of: ${query}`,
        messages: [
          user(
            `Research what's being said on Threads about: ${query}

1. \`search\` with type "posts" and limit ${n}.
2. \`search\` with type "users" and limit ${n} for accounts in this space.
3. For any post that looks substantive, \`get_thread_replies\` on its \`code\` —
   the replies are usually where the actual discussion is.

Report back with the themes you see, who is driving the conversation, and any
post worth my responding to (with its \`url\`).

Two things to be honest about rather than paper over: Threads search is shallow
and a sparse query genuinely returns few results — say so instead of running the
same search repeatedly with different limits. And user results from search are
thin stubs, so follower counts are often missing; do not present a ranking you
cannot actually support.

Read-only. Do not follow, like, or reply to anyone.

${STRUCTURED}`,
          ),
        ],
      };
    },
  );

  // ── account_health ─────────────────────────────────────────────────────────
  server.registerPrompt(
    'account_health',
    {
      title: 'Check account health',
      description:
        'Verify the session is valid and that this server can still drive the Threads UI. Run this first when tools start behaving oddly.',
      argsSchema: {},
    },
    () => ({
      description: 'Diagnose the Threads MCP session and UI anchors',
      messages: [
        user(
          `Check whether this Threads server is working.

1. \`whoami\` — which account is signed in, and is the session valid?
2. \`doctor\` with deep=true — this checks every DOM anchor the write tools
   depend on, and the read path separately.

Interpret the result rather than dumping it:
- All checks pass → say so in one line and stop.
- \`session\` fails → the login expired. Tell me to re-run \`npm run login\`, or
  to import a session if I'm on a machine without a display.
- Anchor checks fail → Meta has likely changed the UI. Tell me which tools stop
  working (doctor reports the impact per anchor) and point me at
  \`src/browser/selectors.ts\`, where the anchors are declared.
- Extraction checks fail while anchors pass → the read path broke independently
  of the UI; that is a GraphQL/payload change, not a moved button.

Do not attempt to fix anything or run any write tool. This is diagnosis only.`,
        ),
      ],
    }),
  );
}
