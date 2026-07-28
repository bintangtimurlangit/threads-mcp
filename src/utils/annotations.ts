// ─── Tool annotations ─────────────────────────────────────────────────────────
//
// MCP annotations are *hints* that let a client show side effects up front and
// decide what to confirm before running. They matter more here than in most
// servers: every write drives a REAL Threads account, so a client that surfaces
// "destructive" can prompt before `delete_thread` wipes a post.
//
// Two spec details worth remembering:
//   • `destructiveHint` is only meaningful when `readOnlyHint` is false, and it
//     DEFAULTS TO TRUE — so non-destructive writes must say so explicitly, or
//     clients will over-confirm every like and follow.
//   • `idempotentHint` means "repeating the call with the same args changes
//     nothing further". Liking twice leaves one like (idempotent); posting twice
//     leaves two posts (not).

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/** Read-only Threads lookup: no side effects, safe to retry, hits the live site. */
export const READ: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

/** A write that produces new content every call (post twice → two posts). */
export const WRITE_CREATES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** A write that drives state to a known value (like twice → still one like). */
export const WRITE_TOGGLES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** An irreversible write — clients should confirm before running these. */
export const WRITE_DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

/** Reads local state only (the scheduler queue on disk) — no network. */
export const LOCAL_READ: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/** Mutates local state only (the scheduler queue) — nothing reaches Threads. */
export const LOCAL_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** Cancels a queued job locally: repeating it is a no-op, so idempotent. */
export const LOCAL_WRITE_IDEMPOTENT: ToolAnnotations = {
  ...LOCAL_WRITE,
  idempotentHint: true,
};
