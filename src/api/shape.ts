// ─── Structured tool output ───────────────────────────────────────────────────
//
// Every tool used to return markdown and nothing else, so an agent chaining
// `search` → `like_thread` had to regex a shortcode out of prose. That works
// until a post's text happens to contain something shortcode-shaped.
//
// These are the JSON projections returned alongside the rendered text. They are
// deliberately flat and stable: a small, named surface we control, rather than
// Meta's nested payloads, which reshuffle between app builds and are exactly
// what the defensive extractors exist to absorb. Adding a field here is cheap;
// leaking Meta's shape to clients would make every upstream rename a breaking
// change.

import { z } from 'zod';
import type { ThreadsPost, ThreadsUser } from './types.js';
import { postText, postLink, avatarUrl } from '../utils/format.js';
import { BASE_URL } from '../browser/session.js';

export const PostSchema = z.object({
  id: z.string().optional().describe('Numeric post id (pk)'),
  code: z.string().optional().describe('Shortcode — pass to any tool taking `code`'),
  url: z.string().optional().describe('Canonical permalink'),
  author: z.string().optional().describe('Author @handle, without the @'),
  author_verified: z.boolean().describe('Whether the author is verified'),
  text: z.string().describe('Post text, empty for media-only posts'),
  created_at: z.string().optional().describe('ISO 8601 timestamp'),
  likes: z.number(),
  replies: z.number(),
  reposts: z.number(),
  quotes: z.number(),
  media: z.enum(['none', 'image', 'video']).describe('Kind of attached media, if any'),
  is_reply: z.boolean(),
  quoted: z
    .object({
      author: z.string().optional(),
      text: z.string(),
      url: z.string().optional(),
    })
    .optional()
    .describe('The post this one quotes, when it is a quote-post'),
});
export type PostOut = z.infer<typeof PostSchema>;

export const UserSchema = z.object({
  id: z.string().optional(),
  handle: z.string().optional().describe('@handle, without the @'),
  name: z.string().optional(),
  bio: z.string().optional(),
  verified: z.boolean(),
  followers: z.number().optional(),
  following: z.number().optional(),
  url: z.string().optional(),
  avatar: z.string().optional(),
});
export type UserOut = z.infer<typeof UserSchema>;

/** Project a raw Threads post into the stable output shape. */
export function toPost(p: ThreadsPost): PostOut {
  const info = p.text_post_app_info;
  const embedded = info?.share_info?.quoted_post ?? info?.share_info?.reposted_post ?? undefined;
  return {
    id: p.pk ?? p.id,
    code: p.code,
    url: postLink(p),
    author: p.user?.username,
    author_verified: Boolean(p.user?.is_verified),
    text: postText(p),
    // taken_at is unix seconds; ISO is unambiguous for a consumer that has to
    // reason about "before/after" without knowing our timezone.
    created_at: p.taken_at ? new Date(p.taken_at * 1000).toISOString() : undefined,
    likes: p.like_count ?? 0,
    replies: info?.direct_reply_count ?? info?.reply_count ?? 0,
    reposts: info?.reposts_count ?? 0,
    quotes: info?.quote_count ?? 0,
    media:
      (p.video_versions?.length ?? 0) > 0
        ? 'video'
        : (p.image_versions2?.candidates?.length ?? 0) > 0
          ? 'image'
          : 'none',
    is_reply: Boolean(info?.is_reply),
    quoted: embedded
      ? { author: embedded.user?.username, text: postText(embedded), url: postLink(embedded) }
      : undefined,
  };
}

/** Project a raw Threads user into the stable output shape. */
export function toUser(u: ThreadsUser): UserOut {
  return {
    id: u.pk ?? u.id,
    handle: u.username,
    name: u.full_name,
    bio: u.biography,
    verified: Boolean(u.is_verified),
    followers: u.follower_count,
    following: u.following_count,
    url: u.username ? `${BASE_URL}/@${u.username}` : undefined,
    avatar: avatarUrl(u),
  };
}
