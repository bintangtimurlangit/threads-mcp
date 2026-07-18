# Security

## Supported versions

Security fixes are applied to the **latest release** on the default branch when practical.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for undisclosed security problems.

1. Use [GitHub private vulnerability reporting](https://github.com/bintangtimurlangit/threads-mcp/security/advisories/new) if it is enabled for this repository, **or**
2. Contact the maintainers via a private channel (e.g. email on your GitHub profile).

Include:

- A short description of the issue and its impact
- Steps to reproduce (or a proof-of-concept), if safe to share
- Affected versions or dependency versions, if known

We aim to acknowledge reports within a few days and coordinate disclosure after a fix is available.

## Scope and credential handling

This is a **local MCP server** that drives a **logged-in browser session** as **your own Threads account**. Be aware:

- Your **session lives on your machine** under `~/.threads-mcp/chrome-profile` (configurable via `THREADS_PROFILE_DIR`). Treat that directory like a password — it grants access to your account. It is never transmitted anywhere by this server, and the repo **gitignores** local profile/state.
- The server performs **write actions** (post, reply, like, repost, follow, delete) on your real account. Review what your MCP client is allowed to call.
- No credentials are stored in the repo or in environment variables — authentication is the browser session only.

Issues in **Meta/Threads services**, **CloakBrowser**, or **upstream** dependencies (e.g. `@modelcontextprotocol/sdk`, `playwright`) should be reported to those projects when appropriate.
