import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractActivity } from '../../src/api/extract.js';
import { NotificationSchema, toNotification } from '../../src/api/shape.js';

/** A story in the shape the live Activity feed returns. */
function story(over: {
  type?: number;
  who?: string;
  context?: string;
  content?: string;
  dest?: string | null;
  ts?: number;
  tuuid?: string;
}) {
  return {
    __typename: 'XDTActivityFeedStory',
    story_type: over.type,
    args: {
      tuuid: over.tuuid ?? `t${over.who}${over.ts}`,
      timestamp: over.ts ?? 1_700_000_000,
      profile_name: over.who ?? 'alice',
      destination: over.dest === undefined ? 'user?id=1&username=alice' : over.dest,
      extra: { context: over.context ?? '', content: over.content ?? '', icon_name: 'follow' },
    },
  };
}

const wrap = (...s: unknown[]) => ({
  data: { notifications: { edges: s.map((n) => ({ node: n })) } },
});

describe('extractActivity', () => {
  test('pulls stories out of the notifications envelope', () => {
    const got = extractActivity([wrap(story({ who: 'a', ts: 2 }), story({ who: 'b', ts: 1 }))]);
    assert.equal(got.length, 2);
  });

  test('orders newest first regardless of payload order', () => {
    const got = extractActivity([
      wrap(story({ who: 'old', ts: 1 }), story({ who: 'new', ts: 99 })),
    ]);
    assert.deepEqual(
      got.map((s) => s.args?.profile_name),
      ['new', 'old'],
    );
  });

  test('de-dupes by tuuid across bodies', () => {
    const s = story({ who: 'a', tuuid: 'same' });
    assert.equal(extractActivity([wrap(s), wrap(s)]).length, 1);
  });

  test('ignores everything that is not an activity story', () => {
    const post = { pk: '1', code: 'A', caption: { text: 'x' }, user: { username: 'u' } };
    assert.equal(extractActivity([{ data: { feed: [post] } }]).length, 0);
  });
});

describe('toNotification', () => {
  test('classifies a follow and validates', () => {
    const out = toNotification(
      story({ type: 1305, who: 'alice', context: "You're now following" }),
    );
    NotificationSchema.parse(out);
    assert.equal(out.kind, 'you_followed');
    assert.equal(out.actor, 'alice');
    assert.match(out.url!, /\/@alice$/);
    assert.equal(out.at, new Date(1_700_000_000 * 1000).toISOString());
  });

  test('does not confuse "followed you" with "you followed"', () => {
    // These share an icon and differ only by story_type; reversing the
    // direction would misreport who followed whom.
    const out = toNotification(story({ type: 999999, context: 'Followed you', who: 'bob' }));
    assert.equal(out.kind, 'followed_you');
  });

  test('extracts a post shortcode and builds a permalink', () => {
    const out = toNotification(
      story({
        type: 21341,
        who: 'carol',
        context: 'Because you follow',
        content: 'a post body',
        dest: 'media?id=123_456&shortcode=DbFzEQJEmGY',
      }),
    );
    NotificationSchema.parse(out);
    assert.equal(out.post_code, 'DbFzEQJEmGY');
    assert.equal(out.text, 'a post body');
    assert.match(out.url!, /\/@carol\/post\/DbFzEQJEmGY$/);
  });

  test('falls back to "other" but keeps the label for an unmapped type', () => {
    // The story_type table is partial by construction, so an unknown code must
    // stay usable rather than being dropped or mislabelled.
    const out = toNotification(story({ type: 424242, context: 'Something new', who: 'dave' }));
    NotificationSchema.parse(out);
    assert.equal(out.kind, 'other');
    assert.equal(out.label, 'Something new');
    assert.equal(out.actor, 'dave');
  });

  test('validates when the story is almost empty', () => {
    const out = toNotification({ __typename: 'XDTActivityFeedStory' });
    NotificationSchema.parse(out);
    assert.equal(out.kind, 'other');
    assert.equal(out.label, '');
  });
});
