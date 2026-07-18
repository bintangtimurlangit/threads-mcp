#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerReadTools } from './tools/read.js';
import { registerWriteTools } from './tools/write.js';
import { registerScheduleTools } from './tools/schedule.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { closeContext } from './browser/session.js';

async function main() {
  const server = new McpServer({
    name: 'threads-mcp',
    version: '0.1.0',
  });

  // Every tool runs through the shared, logged-in CloakBrowser session
  // (see src/browser/session.ts) — sign in once with `npm run login`.
  // Reads intercept the app's GraphQL; writes drive the real UI and are
  // rate-limited (see src/utils/ratelimit.ts).
  registerReadTools(server);
  registerWriteTools(server);
  registerScheduleTools(server);

  // Start the persisted scheduled-post loop (see src/scheduler.ts).
  startScheduler();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (process.env.DEBUG === 'true') {
    process.stderr.write(
      '[threads-mcp] Server started via stdio (browser-backed, cookie session)\n',
    );
  }
}

// Tidy up the browser on shutdown.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopScheduler();
    void closeContext().finally(() => process.exit(0));
  });
}

main().catch((err) => {
  process.stderr.write(`[threads-mcp] Fatal error: ${err}\n`);
  process.exit(1);
});
