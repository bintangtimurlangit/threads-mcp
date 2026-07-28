import type { ThreadsPost, ThreadsUser } from '../api/types.js';
import { BASE_URL } from '../browser/session.js';
import { compact, truncate } from './errors.js';

/** Post text, from caption. */
export function postText(p: ThreadsPost): string {
  return p.caption?.text?.trim() ?? '';
}

/** Best profile-picture URL available on a user. */
export function avatarUrl(u: ThreadsUser): string | undefined {
  return u.hd_profile_pic_url_info?.url ?? u.profile_pic_url;
}

/** "2h", "3d", "5w", or an ISO date for older posts. */
export function relativeTime(takenAt?: number): string {
  if (!takenAt) return '';
  const then = takenAt * 1000;
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return new Date(then).toISOString().slice(0, 10);
}

/** Direct URL to a post, if we can build one. */
export function postLink(p: ThreadsPost): string | undefined {
  const handle = p.user?.username;
  if (handle && p.code) return `${BASE_URL}/@${handle}/post/${p.code}`;
  return undefined;
}

/** One post rendered as a compact markdown block. */
export function renderPost(p: ThreadsPost, opts: { index?: number } = {}): string {
  const u = p.user;
  const verified = u?.is_verified ? ' ✔' : '';
  const handle = u?.username ? `@${u.username}` : '(unknown)';
  const when = relativeTime(p.taken_at);
  const header = `${opts.index ? `${opts.index}. ` : ''}**${handle}**${verified}${when ? ` · ${when}` : ''}`;

  const info = p.text_post_app_info;
  const replies = info?.direct_reply_count ?? info?.reply_count ?? 0;
  const reposts = info?.reposts_count ?? 0;
  const quotes = info?.quote_count ?? 0;
  const likes = p.like_count ?? 0;

  const stats =
    `❤️ ${compact(likes)}` +
    `  💬 ${compact(replies)}` +
    `  🔁 ${compact(reposts)}` +
    (quotes ? `  ❝ ${compact(quotes)}` : '');

  const lines = [header];
  const text = truncate(postText(p), 500);
  if (text) lines.push(text);
  if (info?.link_preview_attachment?.url) {
    lines.push(`🔗 ${info.link_preview_attachment.title ?? info.link_preview_attachment.url}`);
  }
  if ((p.video_versions?.length ?? 0) > 0) lines.push('🎬 [video]');
  else if ((p.image_versions2?.candidates?.length ?? 0) > 0) lines.push('🖼 [image]');
  // An embedded quote/repost is part of this post, not a separate feed entry,
  // so show it inline as a single attributed line.
  const embedded = info?.share_info?.quoted_post ?? info?.share_info?.reposted_post;
  if (embedded) {
    const who = embedded.user?.username ? `@${embedded.user.username}` : 'unknown';
    const quoted = truncate(postText(embedded), 140);
    lines.push(`❝ ${who}${quoted ? `: ${quoted}` : ''}`);
  }
  lines.push(stats);
  const link = postLink(p);
  if (link) lines.push(`↳ ${link}${p.pk ? `  ·  id: \`${p.pk}\`` : ''}`);
  return lines.join('\n');
}

/** A user rendered as a one-liner (for followers / search lists). */
export function renderUserLine(u: ThreadsUser, index?: number): string {
  const verified = u.is_verified ? ' ✔' : '';
  const name = u.full_name ? ` — ${u.full_name}` : '';
  const followers =
    u.follower_count !== undefined ? `  ·  ${compact(u.follower_count)} followers` : '';
  return `${index ? `${index}. ` : ''}**@${u.username}**${verified}${name}${followers}`;
}

/** A full profile header block. */
export function renderProfile(u: ThreadsUser): string {
  const verified = u.is_verified ? ' ✔' : '';
  const lines = [`🧵 **@${u.username}**${verified}`];
  if (u.full_name) lines.push(u.full_name);
  if (u.biography) lines.push('', u.biography.trim());
  const stats: string[] = [];
  if (u.follower_count !== undefined) stats.push(`👥 ${compact(u.follower_count)} followers`);
  if (u.following_count !== undefined) stats.push(`following ${compact(u.following_count)}`);
  if (stats.length) lines.push('', stats.join('  ·  '));
  if (u.pk) lines.push('', `id: \`${u.pk}\``);
  if (u.username) lines.push(`🔗 ${BASE_URL}/@${u.username}`);
  return lines.join('\n');
}
