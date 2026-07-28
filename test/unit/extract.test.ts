/**
 * Extractor tests.
 *
 * These matter more than their size suggests. The extractors are the layer that
 * absorbs Meta reshaping its GraphQL payloads, and until now nothing checked
 * them: `npm test` is a live smoke test that needs a browser and a login, so CI
 * only ever ran lint/typecheck/build. Extraction could break against a green CI.
 *
 * Fixtures are hand-built to the *shape* Threads returns, not captured verbatim,
 * so they stay readable and carry no account data.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractPosts, extractUser, extractUsers } from '../../src/api/extract.js';
import type { ThreadsPost } from '../../src/api/types.js';

/** A post node in the shape Threads nests inside `thread_items`. */
function post(over: Partial<ThreadsPost> & { pk: string }): ThreadsPost {
  return {
    code: `CODE${over.pk}`,
    caption: { text: `post ${over.pk}` },
    user: { username: 'alice', pk: 'u1' },
    like_count: 1,
    ...over,
  };
}

/** Wrap posts the way a feed response does: edges → node → thread_items. */
function feed(...groups: ThreadsPost[][]) {
  return {
    data: {
      feedData: {
        edges: groups.map((items, i) => ({
          node: { id: `n${i}`, thread_items: items.map((p) => ({ post: p })) },
        })),
      },
    },
  };
}

describe('extractPosts', () => {
  test('pulls posts out of nested feed edges in document order', () => {
    const posts = extractPosts([feed([post({ pk: '1' })], [post({ pk: '2' })])]);
    assert.deepEqual(
      posts.map((p) => p.pk),
      ['1', '2'],
    );
  });

  test('does not report an embedded quoted post as its own entry', () => {
    // The regression this guards: a quote-post surfaced twice — as itself, and
    // again as the post it quoted, attributed to a different author.
    const quote = post({
      pk: '2',
      user: { username: 'bob', pk: 'u2' },
      text_post_app_info: {
        share_info: {
          quoted_post: post({ pk: '99', user: { username: 'carol', pk: 'u3' } }),
        },
      },
    });
    const posts = extractPosts([feed([post({ pk: '1' })], [quote])]);
    assert.deepEqual(
      posts.map((p) => p.pk),
      ['1', '2'],
    );
    assert.equal(
      posts.find((p) => p.pk === '99'),
      undefined,
      'quoted post must not be a top-level entry',
    );
  });

  test('keeps the quoted post reachable on its container', () => {
    const quoted = post({ pk: '99', user: { username: 'carol', pk: 'u3' } });
    const quote = post({ pk: '2', text_post_app_info: { share_info: { quoted_post: quoted } } });
    const [got] = extractPosts([feed([quote])]);
    assert.equal(got.text_post_app_info?.share_info?.quoted_post?.pk, '99');
  });

  test('still walks reply chains, which nest above the post level', () => {
    const root = post({ pk: '3' });
    const reply = post({ pk: '4', text_post_app_info: { is_reply: true } });
    const posts = extractPosts([feed([root, reply])]);
    assert.deepEqual(
      posts.map((p) => p.pk),
      ['3', '4'],
    );
  });

  test('de-dupes the same post appearing in several bodies', () => {
    const p = post({ pk: '1' });
    const posts = extractPosts([feed([p]), feed([p])]);
    assert.equal(posts.length, 1);
  });

  test('skips stubs with neither author nor text but descends into them', () => {
    const wrapper = { pk: 'stub', code: 'STUB', caption: null, inner: post({ pk: '7' }) };
    const posts = extractPosts([{ data: { x: wrapper } }]);
    assert.deepEqual(
      posts.map((p) => p.pk),
      ['7'],
    );
  });

  test('survives a payload shape it has never seen', () => {
    // The whole point of walking defensively: an unrecognised envelope should
    // degrade to "found nothing", never throw.
    assert.doesNotThrow(() => extractPosts([{ totally: { unexpected: [1, 'two', null] } }]));
    assert.deepEqual(extractPosts([null, undefined, 42, 'str']), []);
  });

  test('tolerates cyclic references', () => {
    const a: Record<string, unknown> = { pk: '1', code: 'A', caption: { text: 'x' } };
    a.self = a;
    assert.doesNotThrow(() => extractPosts([a]));
  });
});

describe('extractUser', () => {
  test('prefers the richest profile object over thin author stubs', () => {
    const thin = { username: 'alice', pk: 'u1' };
    const rich = {
      username: 'alice',
      pk: 'u1',
      biography: 'bio',
      follower_count: 10,
      following_count: 2,
      full_name: 'Alice',
    };
    const got = extractUser([{ a: thin, b: rich }], 'alice');
    assert.equal(got?.follower_count, 10);
  });

  test('honours the @ prefix and is case-insensitive', () => {
    const u = { username: 'Alice', pk: 'u1', follower_count: 3 };
    assert.equal(extractUser([{ u }], '@alice')?.follower_count, 3);
  });

  test('returns undefined when the requested user is absent', () => {
    assert.equal(extractUser([{ u: { username: 'bob', pk: 'u2' } }], 'alice'), undefined);
  });
});

describe('extractUsers', () => {
  test('de-dupes by username and respects the limit', () => {
    const bodies = [
      {
        list: [
          { username: 'a', pk: '1' },
          { username: 'b', pk: '2' },
          { username: 'a', pk: '1' },
          { username: 'c', pk: '3' },
        ],
      },
    ];
    assert.deepEqual(
      extractUsers(bodies).map((u) => u.username),
      ['a', 'b', 'c'],
    );
    assert.equal(extractUsers(bodies, 2).length, 2);
  });
});
