# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0/). For **how** we version, tag, and publish, see [docs/RELEASES.md](./docs/RELEASES.md).

## [Unreleased]

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

[Unreleased]: https://github.com/bintangtimurlangit/threads-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/bintangtimurlangit/threads-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/bintangtimurlangit/threads-mcp/releases/tag/v0.1.0
