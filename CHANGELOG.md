# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0/). For **how** we version, tag, and publish, see [docs/RELEASES.md](./docs/RELEASES.md).

## [Unreleased]

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

[Unreleased]: https://github.com/bintangtimurlangit/threads-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/bintangtimurlangit/threads-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/bintangtimurlangit/threads-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/bintangtimurlangit/threads-mcp/releases/tag/v0.1.0
