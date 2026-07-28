#!/usr/bin/env node
/**
 * Copy the bundled Agent Skill into a Claude skills directory.
 *
 *   npm run install-skill              # ~/.claude/skills/threads-mcp
 *   npm run install-skill -- --project # ./.claude/skills/threads-mcp
 *
 * Agent Skills are a Claude-side mechanism, not part of MCP — the server can't
 * deliver one over the protocol, so it ships in the package and gets copied
 * into place. Non-Claude MCP hosts get the equivalent guidance through the
 * server's prompts (see src/prompts.ts), which need no installation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'threads-mcp';
const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '..', 'skills', NAME);

const project = process.argv.includes('--project');
const root = project ? path.resolve('.claude') : path.join(os.homedir(), '.claude');
const dest = path.join(root, 'skills', NAME);

if (!fs.existsSync(source)) {
  console.error(`❌ Bundled skill not found at ${source}`);
  process.exit(1);
}

// Refuse to clobber a customised copy without saying so. The skill is meant to
// be edited — someone's local changes are more valuable than a silent refresh.
if (fs.existsSync(dest)) {
  const force = process.argv.includes('--force');
  if (!force) {
    console.error(
      `⚠️  ${dest} already exists.\n` +
        `   Re-run with --force to overwrite it (any local edits are lost),\n` +
        `   or diff it against ${path.relative(process.cwd(), source)} first.`,
    );
    process.exit(1);
  }
  fs.rmSync(dest, { recursive: true, force: true });
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(source, dest, { recursive: true });

const files = [];
for (const entry of fs.readdirSync(dest, { recursive: true, withFileTypes: true })) {
  if (entry.isFile())
    files.push(path.relative(dest, path.join(entry.parentPath ?? dest, entry.name)));
}

console.log(`✅ Installed the "${NAME}" skill to ${dest}`);
for (const f of files.sort()) console.log(`     ${f}`);
console.log(
  `\n   ${project ? 'Project' : 'User'}-level — Claude loads it when a Threads task comes up.` +
    `\n   Start a new session to pick it up.\n`,
);
