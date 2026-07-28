# Development

Requires Node.js 20 or newer. CI covers Node.js 20, 22, and 24.

## Scripts

| Command             | Description                                                 |
| ------------------- | ----------------------------------------------------------- |
| `npm install`       | Install dependencies (also fetches the CloakBrowser binary) |
| `npm run login`     | One-time: open a browser window and log into Threads        |
| `npm run build`     | Compile TypeScript to `build/` (`tsc`)                      |
| `npm run dev`       | Watch mode: `tsx watch src/index.ts`                        |
| `npm run start`     | Run compiled server: `node build/index.js`                  |
| `npm run lint`      | ESLint over the repo                                        |
| `npm run format`    | Prettier write; `npm run format:check` to verify            |
| `npm run typecheck` | `tsc --noEmit`, strict, with unused-symbol checks           |
| `npm test`          | **Live READ-only smoke test** — needs a login and a display |

## Project layout

```
src/
  index.ts          # MCP server entry; registers all tool groups
  login.ts          # one-time interactive login (npm run login)
  scheduler.ts      # persisted queue + poll loop for scheduled posts
  api/
    client.ts       # GraphQL/page capture via the browser session
    extract.ts      # defensive walkers that pull posts/users from responses
    types.ts        # shared types
  browser/
    session.ts      # CloakBrowser persistent-profile session
  tools/
    read.ts         # whoami, get_profile, get_thread, get_timeline, search, …
    write.ts        # create/reply/quote/delete/like/repost/follow (rate-limited)
    schedule.ts     # schedule_thread, list_scheduled, cancel_scheduled
  utils/
    cache.ts        # in-memory TTL cache
    errors.ts       # error wrapper / friendly messages
    format.ts       # serialization helpers
    ratelimit.ts    # write-action spacing
test/
  smoke.ts          # the npm test READ-only health check
```

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
