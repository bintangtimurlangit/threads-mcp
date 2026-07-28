// ─── Defensive extractors ──────────────────────────────────────────────────────
//
// Threads' GraphQL payloads are deeply nested and reshuffle between app builds.
// Rather than hard-code a path, we walk each captured JSON body and pull out the
// recognizable leaf objects: `post` nodes and `user` nodes. Order is preserved
// (DFS) so a profile/feed reads top-to-bottom, and we de-dupe by id.

import type { ThreadsPost, ThreadsUser, ActivityStory } from './types.js';

type Json = unknown;

function isObject(v: Json): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Depth-first visit of every object/array node.
 *
 * `visit` may return `false` to skip the current object's children, which is
 * how `extractPosts` avoids descending into a post it has already claimed.
 */
function walk(node: Json, visit: (o: Record<string, unknown>) => boolean | void): void {
  const stack: Json[] = [node];
  const seen = new Set<Json>();
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    if (Array.isArray(cur)) {
      seen.add(cur);
      // push in reverse so array order is preserved on the LIFO stack
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
    } else if (isObject(cur)) {
      seen.add(cur);
      if (visit(cur) === false) continue;
      const keys = Object.keys(cur);
      for (let i = keys.length - 1; i >= 0; i--) stack.push(cur[keys[i]]);
    }
  }
}

/** Does this object look like a Threads post? */
function looksLikePost(o: Record<string, unknown>): boolean {
  const hasId = typeof o.pk === 'string' || typeof o.id === 'string' || typeof o.code === 'string';
  const hasPostShape =
    'caption' in o || 'text_post_app_info' in o || 'like_count' in o || 'taken_at' in o;
  return hasId && hasPostShape && ('code' in o || 'text_post_app_info' in o || 'caption' in o);
}

/** Does this object look like a Threads user/profile? */
function looksLikeUser(o: Record<string, unknown>): boolean {
  return typeof o.username === 'string' && ('pk' in o || 'id' in o || 'profile_pic_url' in o);
}

function postKey(p: ThreadsPost): string {
  return String(p.pk ?? p.id ?? p.code ?? Math.random());
}

/**
 * Collect all posts across the captured bodies, in document order, de-duped.
 *
 * Once an object is claimed as a post we stop descending into it. A post can
 * embed other posts — `text_post_app_info.share_info.quoted_post`, a reposted
 * original — and those are *part of* the containing post, not separate feed
 * entries. Walking blindly into them made a single quote-post surface twice: as
 * itself and again as the post it quoted, which is why timelines showed items
 * the user never scrolled past.
 *
 * Reply chains are unaffected: Threads nests those as `thread_items[].post`
 * under a container node that isn't itself post-shaped, so traversal still
 * reaches each one.
 */
export function extractPosts(bodies: Json[]): ThreadsPost[] {
  const out: ThreadsPost[] = [];
  const seen = new Set<string>();
  for (const body of bodies) {
    walk(body, (o) => {
      if (!looksLikePost(o)) return;
      const p = o as ThreadsPost;
      // Stub/placeholder with no author and no text: not a post worth
      // reporting, but it may *wrap* one, so keep descending.
      if (!p.user?.username && !p.caption?.text) return;
      const k = postKey(p);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
      return false; // claimed — its nested posts belong to it
    });
  }
  return out;
}

/**
 * Find the richest user object, optionally matching a username. "Richest" = most
 * profile fields present (biography/follower_count/full_name), so we prefer the
 * profile header over the thin author stubs embedded in each post.
 */
export function extractUser(bodies: Json[], username?: string): ThreadsUser | undefined {
  const target = username?.replace(/^@/, '').toLowerCase();
  let best: ThreadsUser | undefined;
  let bestScore = -1;
  for (const body of bodies) {
    walk(body, (o) => {
      if (!looksLikeUser(o)) return;
      const u = o as ThreadsUser;
      if (target && u.username?.toLowerCase() !== target) return;
      const score =
        (u.biography !== undefined ? 2 : 0) +
        (u.follower_count !== undefined ? 3 : 0) +
        (u.following_count !== undefined ? 1 : 0) +
        (u.full_name ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    });
  }
  return best;
}

/**
 * Collect Activity-feed entries, newest first, de-duped by their `tuuid`.
 *
 * Matched on `__typename === 'XDTActivityFeedStory'` rather than by shape: these
 * carry no `code`/`caption`, so the post and user heuristics don't apply, and
 * the typename is what the payload actually labels them with.
 */
export function extractActivity(bodies: Json[]): ActivityStory[] {
  const out: ActivityStory[] = [];
  const seen = new Set<string>();
  for (const body of bodies) {
    walk(body, (o) => {
      if (o.__typename !== 'XDTActivityFeedStory') return;
      const s = o as ActivityStory;
      const k = s.args?.tuuid ?? `${s.args?.timestamp}:${s.args?.profile_name}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(s);
      return false; // the story owns its nested user/post objects
    });
  }
  return out.sort((a, b) => (b.args?.timestamp ?? 0) - (a.args?.timestamp ?? 0));
}

/** Collect all distinct users across the bodies (for followers / search). */
export function extractUsers(bodies: Json[], limit = 100): ThreadsUser[] {
  const out: ThreadsUser[] = [];
  const seen = new Set<string>();
  for (const body of bodies) {
    walk(body, (o) => {
      if (!looksLikeUser(o)) return;
      const u = o as ThreadsUser;
      const k = (u.username ?? u.pk ?? u.id ?? '').toString().toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      if (out.length < limit) out.push(u);
    });
  }
  return out;
}
