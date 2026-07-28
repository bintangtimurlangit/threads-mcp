import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PostSchema, UserSchema, toPost, toUser } from '../../src/api/shape.js';

describe('toPost', () => {
  test('projects a full post and validates against the schema', () => {
    const out = toPost({
      pk: '123',
      code: 'ABC',
      caption: { text: 'hello' },
      user: { username: 'alice', is_verified: true },
      like_count: 10,
      taken_at: 1_700_000_000,
      text_post_app_info: { direct_reply_count: 2, reposts_count: 3, quote_count: 1 },
    });
    PostSchema.parse(out);
    assert.equal(out.code, 'ABC');
    assert.equal(out.author, 'alice');
    assert.equal(out.author_verified, true);
    assert.equal(out.likes, 10);
    assert.equal(out.replies, 2);
    assert.match(out.url!, /\/@alice\/post\/ABC$/);
    assert.equal(out.created_at, new Date(1_700_000_000 * 1000).toISOString());
  });

  test('validates even when Threads omits nearly everything', () => {
    // The payloads are trimmed per surface, so the projection has to hold up
    // with almost nothing present — otherwise outputSchema validation fails at
    // runtime and the whole tool call errors out.
    const out = toPost({ pk: '1' });
    PostSchema.parse(out);
    assert.equal(out.text, '');
    assert.equal(out.likes, 0);
    assert.equal(out.media, 'none');
    assert.equal(out.is_reply, false);
    assert.equal(out.author_verified, false);
    assert.equal(out.url, undefined);
    assert.equal(out.quoted, undefined);
  });

  test('reports media kind, preferring video', () => {
    assert.equal(
      toPost({ pk: '1', image_versions2: { candidates: [{ url: 'i' }] } }).media,
      'image',
    );
    assert.equal(
      toPost({
        pk: '1',
        video_versions: [{ url: 'v' }],
        image_versions2: { candidates: [{ url: 'i' }] },
      }).media,
      'video',
      'a video post also carries a thumbnail, so video must win',
    );
  });

  test('surfaces an embedded quote as a nested object, not a sibling post', () => {
    const out = toPost({
      pk: '1',
      text_post_app_info: {
        share_info: {
          quoted_post: { code: 'Q', caption: { text: 'original' }, user: { username: 'carol' } },
        },
      },
    });
    PostSchema.parse(out);
    assert.equal(out.quoted?.author, 'carol');
    assert.equal(out.quoted?.text, 'original');
  });

  test('falls back to reply_count when direct_reply_count is absent', () => {
    assert.equal(toPost({ pk: '1', text_post_app_info: { reply_count: 7 } }).replies, 7);
  });
});

describe('toUser', () => {
  test('projects a full profile and validates', () => {
    const out = toUser({
      pk: 'u1',
      username: 'alice',
      full_name: 'Alice',
      biography: 'bio',
      follower_count: 100,
      following_count: 50,
      is_verified: true,
    });
    UserSchema.parse(out);
    assert.equal(out.handle, 'alice');
    assert.equal(out.followers, 100);
    assert.match(out.url!, /\/@alice$/);
  });

  test('validates on a bare stub', () => {
    const out = toUser({ username: 'bob' });
    UserSchema.parse(out);
    assert.equal(out.verified, false);
    assert.equal(out.followers, undefined);
  });

  test('prefers the HD avatar when both are present', () => {
    const out = toUser({
      username: 'a',
      profile_pic_url: 'low',
      hd_profile_pic_url_info: { url: 'high' },
    });
    assert.equal(out.avatar, 'high');
  });
});
