# Configuration

For installing the package or cloning the repo, see **[Installation](../README.md#installation)** in the README.

> **Login required.** This server acts as your own Threads account via a saved browser session. Run `npm run login` once before use. There are no API keys — authentication is the browser session under `~/.threads-mcp/chrome-profile`.

---

## Environment variables

All optional. Set them in your MCP client's **`env`** block, or copy `.env.example` to `.env` when developing from a checkout.

| Variable                         | Default                         | Description                                           |
| -------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `THREADS_DOMAIN`                 | `threads.com`                   | Threads domain (`threads.net` redirects here).        |
| `THREADS_PROFILE_DIR`            | `~/.threads-mcp/chrome-profile` | Where the saved login lives.                          |
| `THREADS_HEADLESS`               | `false`                         | Keep `false` — headless is detected.                  |
| `THREADS_MIN_ACTION_INTERVAL_MS` | `8000`                          | Minimum gap between write actions. Raise to be safer. |
| `CACHE_TTL_MS`                   | `30000`                         | In-memory read-cache lifetime.                        |
| `DEBUG`                          | `false`                         | Log startup, GraphQL op names, scheduler ticks.       |

---

## MCP configuration (all clients)

This server uses **stdio** and launches a **headed** browser, so it needs a display. On a headless machine, wrap the command in `xvfb-run`.

### With a virtual display (servers)

```json
{
  "mcpServers": {
    "threads": {
      "command": "xvfb-run",
      "args": ["-a", "node", "/absolute/path/to/threads-mcp/build/index.js"]
    }
  }
}
```

### With a real display (desktop / WSLg)

```json
{
  "mcpServers": {
    "threads": {
      "command": "node",
      "args": ["/absolute/path/to/threads-mcp/build/index.js"]
    }
  }
}
```

Use an **absolute** path to `build/index.js`. For reliable scheduling across client restarts, run the server as an always-on daemon — see [Run as a daemon](../README.md#running-as-a-persistent-daemon).

---

## Claude Code

- **CLI:** `claude mcp add threads -- xvfb-run -a node /absolute/path/to/threads-mcp/build/index.js` (drop `xvfb-run -a` on a machine with a display).
- **Project scope:** `.mcp.json` in the repo root. **User scope:** `~/.claude.json`.
- **Restart** or reload so the new server is registered.

## Claude Desktop

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Use the same **`mcpServers`** JSON as above.

## Other editors

Cursor, Zed, Windsurf, and any other **stdio MCP host** use the same pattern: a server whose command is `node` (or `xvfb-run … node`) plus the path to `build/index.js`.
