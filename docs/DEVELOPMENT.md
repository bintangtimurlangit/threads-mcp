# Development

Requires Node.js 20 or newer. CI covers Node.js 20, 22, and 24.

## Scripts

| Command                  | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `npm install`            | Install dependencies (also fetches the CloakBrowser binary)                  |
| `npm run login`          | One-time: open a browser window and log into Threads                         |
| `npm run import-session` | Import an existing session's cookies — no display needed                     |
| `npm run build`          | Compile TypeScript to `build/` (`tsc`)                                       |
| `npm run dev`            | Watch mode: `tsx watch src/index.ts`                                         |
| `npm run start`          | Run compiled server: `node build/index.js`                                   |
| `npm run lint`           | ESLint over the repo                                                         |
| `npm run format`         | Prettier write; `npm run format:check` to verify                             |
| `npm run typecheck`      | `tsc --noEmit`, strict, with unused-symbol checks                            |
| `npm test`               | Unit tests (extractors, formatting, parsing, cache) — no browser             |
| `npm run test:live`      | **Live READ-only smoke test** — needs a login and a display                  |
| `npm run bench`          | Capture-latency harness against a local fixture page                         |
| `npm run install-skill`  | Copy the bundled Agent Skill into ~/.claude/skills (`-- --project` for repo) |
| `npm run graph`          | Build the Graphify knowledge graph (`graphify-out/`, local only)             |

## Project layout

```
src/
  index.ts            # MCP server entry; registers all tool groups + prompts
  prompts.ts          # MCP prompts — workflows, and the safety rules they carry
  login.ts            # one-time interactive login (npm run login)
  import-session.ts   # import cookies instead of logging in (headless machines)
  scheduler.ts        # persisted queue + poll loop for scheduled posts
  api/
    client.ts         # GraphQL/page capture via the browser session
    extract.ts        # defensive walkers pulling posts/users/activity out of responses
    shape.ts          # stable JSON projections returned as structuredContent
    types.ts          # shared types
  browser/
    session.ts        # CloakBrowser persistent-profile session, capture + locking
    selectors.ts      # the DOM anchors writes depend on, and what each one breaks
  tools/
    read.ts           # whoami, get_profile, get_timeline, search, get_notifications, …
    write.ts          # create/reply/quote/delete/like/repost/follow (rate-limited)
    schedule.ts       # schedule_thread, list_scheduled, cancel_scheduled
    doctor.ts         # health check over the session and every anchor
  utils/
    annotations.ts    # MCP tool annotations (read-only / idempotent / destructive)
    cache.ts          # in-memory TTL cache, bounded, flushed after writes
    errors.ts         # error wrapper / friendly messages
    format.ts         # rendering helpers for the text half of each result
    ratelimit.ts      # write-action spacing
skills/
  threads-mcp/        # Agent Skill shipped in the package (Claude-side, not MCP)
scripts/
  install-skill.mjs   # copies the skill into a Claude skills directory
test/
  smoke.ts            # the `npm run test:live` READ-only health check
  capture-bench.ts    # latency harness for the capture path
  unit/               # `npm test` — pure-function tests, no browser
```

Two files carry more weight than their size suggests. `browser/selectors.ts`
documents every DOM anchor the write path depends on, because Meta changes that
UI without notice and a moved anchor otherwise surfaces as a vague "couldn't
confirm" from whichever tool used it — the `doctor` tool checks them all against
the live site. `api/shape.ts` defines the JSON returned alongside each result and
is deliberately **not** Meta's payload shape, so an upstream rename doesn't
become a breaking change for clients.

## How the browser automation works

Threads' web app talks to Meta's Relay GraphQL gateway with per-session tokens and anti-automation fingerprinting, so a hand-rolled `fetch` is rejected. This server drives **[CloakBrowser](https://github.com/CloakHQ/cloakbrowser)** (a fingerprint-patched Chromium) against a persistent profile you log into once:

- **Reads** parse the server-side JSON embedded in each page plus the `/api/graphql` and `/graphql/query` responses. A defensive walker survives Meta renaming operations.
- **Writes** drive the real composer and action buttons so Meta's own client mints the tokens.
- **Scheduling** is a persisted queue (`~/.threads-mcp/scheduled.json`) + poll loop delegating to the same publish path as `create_thread`.

The browser runs **headed** (Meta detects headless); on a server use `xvfb`.

## Build output

`npm run build` emits JavaScript under **`build/`**. The repo **gitignores** `build/`; CI and `prepublishOnly` run `npm run build`.

## Tech stack

- TypeScript, **strict** (with `noUnusedLocals` / `noUnusedParameters`)
- Zod for MCP tool input validation
- `@modelcontextprotocol/sdk` (stdio), CloakBrowser + Playwright
