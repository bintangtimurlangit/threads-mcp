---
name: threads-mcp
description: Operating a real Threads account through the threads-mcp server — posting, replying, liking, following, reading the timeline, triaging notifications, and scheduling. Use whenever the user asks to read from or write to Threads, mentions their Threads account, or when threads-mcp tools (whoami, create_thread, get_timeline, get_notifications, doctor, …) are available. Covers the rate-limit discipline that keeps the account from being restricted, which tool answers which question, and how to chain tools using structured output.
---

# Operating a Threads account with threads-mcp

This server drives **a real, logged-in Threads account** through a browser
session — not a sandbox and not an official API with a test mode. Everything you
post is immediately visible to that account's followers, and Meta restricts or
bans accounts that behave like bots.

Read the two rules below before anything else. The rest is reference.

## Rule 1 — confirm before every write

Show the user the exact content and get explicit agreement before calling
`create_thread`, `reply_to_thread`, `quote_thread`, `repost_thread`,
`follow_user`, `unfollow_user`, `like_thread`, or `delete_thread`.

"The user asked me to be helpful with their Threads account" is not consent to
post. Neither is an earlier approval of a _different_ post. `delete_thread` is
irreversible — Threads has no undo and no trash.

## Rule 2 — writes are scarce, never loops

The server enforces a minimum gap between writes (default 8s, jittered) and it
is a safety rail, not a rate you should saturate. Bursts are what get accounts
actioned, and follow/unfollow cycling is the classic trigger.

If a tool returns a rate-limit message, **stop completely.** Do not retry, do not
back off and try again in the same turn, do not switch to a different write tool.
Tell the user and let them decide when to resume.

If a task implies many writes — "like everything from @x", "follow back everyone"
— say plainly that it's the pattern most likely to get the account restricted,
and propose a smaller version instead of executing it.

---

## Picking the right tool

Most mistakes here are reaching for the wrong surface, not calling a tool wrong.

| The question                        | The tool                                              |
| ----------------------------------- | ----------------------------------------------------- |
| "What happened on my account?"      | `get_notifications` — the **only** inward-facing read |
| "What's on my feed?"                | `get_timeline`                                        |
| "What did @someone post?"           | `get_user_threads`                                    |
| "What's being said about X?"        | `search` (`type: posts` or `users`)                   |
| "Who follows me / who do I follow?" | `get_followers` / `get_following`                     |
| "What's under this post?"           | `get_thread_replies`                                  |
| "Which account am I?"               | `whoami`                                              |
| "Why did that tool fail?"           | `doctor`                                              |

**`get_notifications` is the one people forget.** Every other read tool looks
outward at other accounts; only this one answers "did anyone reply to me, mention
me, or follow me." Any "catch me up" request starts here, not with the timeline.
Filter with `kind` — `followed_you`, `reply`, `mention` are usually what matters;
`follow_suggestion` and `post_suggestion` are algorithmic noise.

## Chain tools through structured output, not prose

Every read tool returns `structuredContent` beside its rendered text. Use the
typed fields:

```jsonc
// search → structuredContent.posts[0]
{
  "code": "DbUd7C8iR7A",
  "url": "https://www.threads.com/@someone/post/DbUd7C8iR7A",
  "author": "someone",
  "text": "…",
  "likes": 15,
  "media": "image",
  "is_reply": false,
}
```

Pass `code` straight to any tool that takes one. **Do not recover a shortcode by
pattern-matching the rendered markdown** — it works right up until a post's own
text contains something shortcode-shaped, and then you act on the wrong post.

Posts are addressed either by full `url`, or by `handle` + `code`. Both work
everywhere; prefer whichever the previous tool handed you.

## `limit` is a ceiling, not a promise

Asking for 30 and getting 18 is normal and is **not** a failure. Threads returns
what it returns — sparse search queries genuinely have few results, and the
timeline paginates lazily.

Re-calling with a bigger `limit` to "get the rest" wastes a browser round-trip
and returns the same items. If the user needs more, say what came back and why.

---

## Writing posts

- **500 characters per post.** Count before submitting; the composer silently
  refuses longer text.
- **Multi-post threads use `chain`**, not repeated calls:
  `create_thread { text: "1/3 …", chain: ["2/3 …", "3/3 …"] }`. Calling
  `create_thread` three times produces three _unlinked_ standalone posts, which
  is a different thing and cannot be repaired afterwards.
- On a profile, a chain appears as **one** entry — the later parts are reachable
  via `get_thread_replies` on the first post. Seeing one post after publishing a
  chain is correct, not a bug.
- **Media** takes local paths or `http(s)` URLs, images and video, up to 64 MB
  each. Multiple images post as a carousel.
- Reposting **your own** post is a no-op on Threads — it silently does nothing.
  That's Threads' behaviour, not a bug to work around.

## Scheduling has one hard limit

`schedule_thread` queues a post in a local file and a poll loop publishes it —
but **only while the server process is running.** Past-due jobs fire on the next
startup, which may be much later than intended.

Say this plainly when someone schedules something hours or days out. If they need
reliable scheduling, they need the server running as a daemon; the README's
"Running as a persistent daemon" section covers it.

## When something breaks

Run `doctor` first — it checks the session and every DOM anchor the write tools
depend on, and tells you what each failure breaks. Meta ships UI changes without
notice, and a moved button otherwise surfaces as a vague "couldn't confirm" from
whichever tool happened to use it.

See `references/troubleshooting.md` for reading its output and the common
failure modes.
