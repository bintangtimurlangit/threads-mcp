# Troubleshooting threads-mcp

Read this when a tool fails, returns nothing, or reports that it couldn't
confirm what it did. Start with `doctor`; it distinguishes the three failure
classes below, which have completely different fixes.

## Start with `doctor`

`doctor` checks the session and every DOM anchor the write tools depend on.
`doctor { "deep": true }` also loads a real post page and the activity feed
(slower — several page loads). It never posts, and it discards any draft the
composer inspection would otherwise leave behind.

Its output names what each failure breaks, so read the impact line rather than
just the ❌:

```
✅ session — session cookie present
✅ composer-add-to-thread — present
❌ post-repost — NOT FOUND

**Impact:**
- `post-repost` → repost_thread / quote_thread / unrepost_thread
```

## The three failure classes

### 1. Session expired

`whoami` reports not signed in, or every tool fails with an auth message.

The saved browser session went stale. The user has to re-authenticate — you
cannot fix this from a tool call:

- With a display: `npm run login` opens a Chromium window to sign in.
- Without one (VPS, container, CI): sign in on a machine that has a display,
  then move the cookies with `threads-mcp-import-session`. See the README's
  "Signing in without a display".

A `sessionid` is a bearer credential for the whole account. Never echo one into
chat, a log, or a file, and never suggest committing one.

### 2. Meta changed the UI

`doctor` reports anchor failures while `session` passes.

The write tools drive Threads' real interface, so a renamed button or moved
`aria-label` breaks them. The anchors are declared in one place —
`src/browser/selectors.ts` — each with a note on what stops working when it
disappears. Fixing it means updating the selector that moved.

Tell the user which tools are affected (doctor's impact lines say) rather than
retrying the failing tool, which will keep failing identically.

### 3. Extraction broke

`doctor` reports `timeline-extraction` or `activity-extraction` failing while
every DOM anchor passes.

Reads don't scrape the DOM — they parse the JSON Threads server-renders into the
page plus the GraphQL responses the app fires. So the read path can break while
the UI is intact: that's an upstream payload change, not a moved button. The
defensive walkers in `src/api/extract.ts` are what absorb it.

## Symptoms that are not bugs

| What you see                             | Why                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Fewer results than `limit`               | `limit` is a ceiling. Sparse queries genuinely return little.                                                      |
| A chain shows as one post on the profile | Correct — Threads renders a chain as a single entry. Later parts are under `get_thread_replies` on the first post. |
| Reposting your own post does nothing     | Threads' behaviour, not a failure.                                                                                 |
| A profile with no posts returns none     | Check whether the account has actually posted before assuming extraction failed.                                   |
| Search users have no follower count      | Search returns thin user stubs; the field is genuinely absent. Don't rank on it.                                   |
| First call after startup is slow         | The browser launches lazily on first use.                                                                          |
| A read repeats an earlier result         | Reads are cached briefly (`CACHE_TTL_MS`, default 30s). Writes flush the cache.                                    |

## "Submitted but couldn't confirm"

Several write tools report this. It means the action was driven but the
post-condition check didn't observe the expected change — the write may well
have succeeded.

**Do not retry blindly** — that's how you end up with a double post. Verify
first: `get_user_threads` for your own posts, or `get_thread` on the target for
likes and reposts. Then act on what you find.

## Timeouts

A single browser operation is bounded (`THREADS_LOCK_TIMEOUT_MS`, default 2 min);
on timeout the page is reset and the queue continues. A tool reporting a timeout
means that operation was abandoned, not that the server is wedged — the next
call gets a clean page.

Large media over a slow link is the legitimate reason to raise it.
