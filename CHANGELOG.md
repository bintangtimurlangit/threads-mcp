# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0/). For **how** we version, tag, and publish, see [docs/RELEASES.md](./docs/RELEASES.md).

## [Unreleased]

### Added

- **MCP prompts** — five workflows exposed as a first-class protocol primitive, so they work in any MCP host (`/threads:catch_up` and friends in Claude Code, `prompts/list` elsewhere): `catch_up`, `triage_notifications`, `draft_thread`, `research_topic`, `account_health`. Every one drafts and stops — none of them publish. The server now advertises the `prompts` capability alongside `tools`.
- **An Agent Skill**, shipped in the package and installed with `npx threads-mcp-install-skill`. Skills are a Claude-side mechanism rather than part of MCP, so it is copied into `~/.claude/skills/` (or `--project`) rather than served over the protocol. Non-Claude hosts get the same discipline through the prompts above.

## [0.2.0] - 2026-07-28

### Added

- **`get_notifications`** — reads the Activity feed (follows, replies, mentions, suggestions), optionally filtered by `kind`. Previously every read tool looked outward, so an agent could post but never notice a reply.
- **`get_following`** — the counterpart to `get_followers`; half the social graph was unreachable.
- **`doctor`** — health check for the session and every DOM anchor the write tools depend on, reporting what each failure breaks. Never posts, and discards any draft it would create.
- **`create_thread` accepts `chain`** — publishes a connected multi-post thread ("Add to thread"). Posting parts separately yields unlinked threads.
- **Structured output** — all read tools declare an `outputSchema` and return `structuredContent`, so callers get typed fields (`code`, `url`, counts) instead of parsing markdown.
- **Tool annotations** — the read-only / idempotent / destructive matrix the README has always documented is now actually emitted; `delete_thread` is the only `destructiveHint`.
- **`threads-mcp-import-session`** — run without a display by importing an existing session's cookies instead of opening a browser to log in.
- **Unit tests in CI** (`npm test`) covering extractors, formatting, parsing, cache, rate limiting and media handling. The live smoke test moved to `npm run test:live`.
- `npm run bench` — capture-latency harness against a local fixture page, no account needed.

### Changed

- Reads harvest Threads' server-rendered JSON **before** dwelling, and stop as soon as the request is satisfied rather than when a fixed timer expires. Scrolling waits on the pagination response instead of sleeping, and stops early when the feed is exhausted.
- Reads are cached beyond `get_profile` (timeline, search, single post, user posts), and every write flushes the cache — previously a `get_profile` right after `create_thread` served the pre-post snapshot.
- The write throttle measures from when the previous write **finished**, not when it started, and applies upward-only jitter.

### Fixed

- **`get_timeline` could return another page's posts, or nothing.** With a scroll trigger present, navigation was skipped when the current URL started with the target — and the home feed's URL is a prefix of every Threads URL, so it never navigated.
- **Quoted posts appeared as separate feed entries**, duplicating quote-posts and consuming `limit` with phantom items.
- **`get_thread_replies` returned the root post as its own first reply** when the URL carried no parseable shortcode.
- **Empty captures were reported as "not signed in"**, sending users to re-authenticate a perfectly valid session.
- The server advertised version `0.1.0` regardless of the released version.
- One hung browser operation blocked every later tool call for the life of the process; operations are now bounded and the page is reset on timeout.
- Media downloads had no timeout, size cap or content-type check; a multi-item `media` list that failed partway leaked the temp files already downloaded.
- The scheduler queue grew without bound and was written non-atomically, so an interrupted save could discard every pending post.

## [0.1.2] - 2026-07-28

### Added

- Setup guide for **Hermes Agent**'s native MCP client, covering stdio registration, tool discovery, `TZ` handling for `schedule_thread`, and headless-login caveats.

### Changed

- **Requires Node.js 20 or newer** (`engines` is now `>=20.0.0`). Node 18 is end-of-life and is no longer supported or tested; CI covers Node 20, 22, and 24.
- Bumped `cloakbrowser` to `^0.5.2` (free tier via GitHub sign-in, GeoIP exit-IP fix for authenticated HTTP proxies, Chromium 150 binary) and `playwright` to `^1.62.0`.
- Refreshed development dependencies: `eslint` 10.8.0, `prettier` 3.9.6, `lint-staged` 17.2.0.

### Fixed

- Restored the missing `Setup` heading in the README and repaired the setup links in `docs/`.
- Refreshed transitive lockfile patches (`@hono/node-server`, `brace-expansion`, `fast-uri`, `tar`), clearing two high-severity audit findings.

## [0.1.1] - 2026-07-21

### Added

- Standardized project scaffolding: `.editorconfig`, ESLint + Prettier, Conventional Commits (commitlint), Husky pre-commit hooks, CI + release workflows, issue/PR templates, and a `docs/` guide set.

### Changed

- Updated runtime and development dependencies, and standardized the npm trusted-publishing release workflow.

## [0.1.0] - 2026-07-14

### Added

- Initial release: MCP server for **Meta's Threads** over stdio, driving a logged-in CloakBrowser session as your own account.
- **21 tools** across read (`whoami`, `get_profile`, `get_user_threads`, `get_thread`, `get_thread_replies`, `get_timeline`, `search`, `get_followers`), write (`create_thread`, `reply_to_thread`, `quote_thread`, `delete_thread`, `like_thread`/`unlike_thread`, `repost_thread`/`unrepost_thread`, `follow_user`/`unfollow_user`), and schedule (`schedule_thread`, `list_scheduled`, `cancel_scheduled`).
- Server-side write throttling (`THREADS_MIN_ACTION_INTERVAL_MS`), in-memory read cache, and a persisted scheduler under `~/.threads-mcp/`.

[Unreleased]: https://github.com/bintangtimurlangit/threads-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bintangtimurlangit/threads-mcp/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/bintangtimurlangit/threads-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/bintangtimurlangit/threads-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/bintangtimurlangit/threads-mcp/releases/tag/v0.1.0
