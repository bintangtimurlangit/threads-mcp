import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compact, truncate } from '../../src/utils/errors.js';
import {
  relativeTime,
  postLink,
  postText,
  renderPost,
  renderUserLine,
} from '../../src/utils/format.js';
import type { ThreadsPost } from '../../src/api/types.js';

describe('compact', () => {
  test('formats counts by magnitude', () => {
    assert.equal(compact(0), '0');
    assert.equal(compact(999), '999');
    assert.equal(compact(1234), '1.2K');
    assert.equal(compact(12_345), '12K');
    assert.equal(compact(1_200_000), '1.2M');
  });

  test('treats missing counts as zero rather than printing undefined', () => {
    assert.equal(compact(undefined), '0');
    assert.equal(compact(null), '0');
  });
});

describe('truncate', () => {
  test('leaves short text alone and ellipsises long text', () => {
    assert.equal(truncate('short', 10), 'short');
    assert.equal(truncate('abcdefghij', 5), 'abcde…');
    assert.equal(
      truncate('abc def ghi', 4),
      'abc…',
      'trailing space is trimmed before the ellipsis',
    );
  });
});

describe('relativeTime', () => {
  const now = Math.floor(Date.now() / 1000);
  test('renders each bucket', () => {
    assert.equal(relativeTime(now), 'just now');
    assert.equal(relativeTime(now - 5 * 60), '5m');
    assert.equal(relativeTime(now - 3 * 3600), '3h');
    assert.equal(relativeTime(now - 2 * 86400), '2d');
    assert.equal(relativeTime(now - 14 * 86400), '2w');
  });

  test('falls back to an ISO date past five weeks', () => {
    assert.match(relativeTime(now - 200 * 86400), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('returns empty for a missing timestamp', () => {
    assert.equal(relativeTime(undefined), '');
  });
});

describe('postLink', () => {
  test('builds a permalink when both author and code are known', () => {
    assert.match(postLink({ code: 'ABC', user: { username: 'alice' } })!, /\/@alice\/post\/ABC$/);
  });

  test('returns undefined when either half is missing', () => {
    assert.equal(postLink({ code: 'ABC' }), undefined);
    assert.equal(postLink({ user: { username: 'alice' } }), undefined);
  });
});

describe('renderPost', () => {
  const base: ThreadsPost = {
    pk: '1',
    code: 'ABC',
    caption: { text: 'hello world' },
    user: { username: 'alice', is_verified: true },
    like_count: 1500,
    text_post_app_info: { direct_reply_count: 2, reposts_count: 3 },
  };

  test('includes handle, verification, text, stats and permalink', () => {
    const out = renderPost(base);
    assert.match(out, /@alice/);
    assert.match(out, /✔/);
    assert.match(out, /hello world/);
    assert.match(out, /1\.5K/);
    assert.match(out, /\/@alice\/post\/ABC/);
  });

  test('numbers entries when given an index', () => {
    assert.match(renderPost(base, { index: 3 }), /^3\. /);
  });

  test('shows an embedded quote inline rather than dropping it', () => {
    const out = renderPost({
      ...base,
      text_post_app_info: {
        ...base.text_post_app_info,
        share_info: {
          quoted_post: { caption: { text: 'the original' }, user: { username: 'carol' } },
        },
      },
    });
    assert.match(out, /❝ @carol: the original/);
  });

  test('marks media', () => {
    assert.match(renderPost({ ...base, video_versions: [{ url: 'v' }] }), /🎬/);
    assert.match(renderPost({ ...base, image_versions2: { candidates: [{ url: 'i' }] } }), /🖼/);
  });

  test('degrades gracefully on an author-less post', () => {
    const out = renderPost({ pk: '9', caption: { text: 'orphan' } });
    assert.match(out, /\(unknown\)/);
    assert.match(out, /orphan/);
  });
});

describe('renderUserLine', () => {
  test('renders handle, name and follower count', () => {
    const line = renderUserLine({ username: 'bob', full_name: 'Bob B', follower_count: 2400 }, 1);
    assert.match(line, /^1\. \*\*@bob\*\*/);
    assert.match(line, /Bob B/);
    assert.match(line, /2\.4K followers/);
  });

  test('omits follower count when absent rather than showing 0', () => {
    assert.doesNotMatch(renderUserLine({ username: 'bob' }), /followers/);
  });
});

describe('postText', () => {
  test('trims, and yields empty string for a missing caption', () => {
    assert.equal(postText({ caption: { text: '  hi  ' } }), 'hi');
    assert.equal(postText({}), '');
    assert.equal(postText({ caption: null }), '');
  });
});
