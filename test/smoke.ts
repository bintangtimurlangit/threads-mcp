#!/usr/bin/env node
/**
 * Live smoke test. Requires a logged-in profile (run `npm run login` first) and
 * a display (use `xvfb-run` on servers). Exercises the READ path only — it does
 * NOT post, like, or follow, so it's safe to run.
 *
 *   npm run test:live
 */
import 'dotenv/config';
import { isLoggedIn, resolveOwnHandle, closeContext } from '../src/browser/session.js';
import { threadsCapture } from '../src/api/client.js';
import { extractPosts, extractUser } from '../src/api/extract.js';
import { profileUrl } from '../src/api/client.js';

async function main() {
  console.log('🧵 threads-mcp smoke test (read-only)\n');

  const logged = await isLoggedIn();
  console.log(`logged in:        ${logged ? '✅' : '❌ (run `npm run login`)'}`);
  if (!logged) {
    await closeContext();
    process.exit(1);
  }

  const handle = await resolveOwnHandle();
  console.log(`own handle:       ${handle ? '@' + handle : '⚠️ could not resolve'}`);

  const target = handle ?? 'zuck';
  console.log(`\nfetching profile @${target} …`);
  const bodies = await threadsCapture(profileUrl(target), 'ProfileThreadsTab', { dwellMs: 4000 });
  console.log(`graphql bodies:   ${bodies.length}`);

  const user = extractUser(bodies, target);
  console.log(
    `profile parsed:   ${user ? `@${user.username} (${user.follower_count ?? '?'} followers)` : '⚠️ none'}`,
  );

  const posts = extractPosts(bodies);
  console.log(`posts parsed:     ${posts.length}`);
  if (posts[0]) {
    const t = posts[0].caption?.text ?? '(no text)';
    console.log(`newest post:      ${t.slice(0, 80)}${t.length > 80 ? '…' : ''}`);
  }

  console.log('\n✅ smoke test done.');
  await closeContext();
}

main().catch(async (err) => {
  console.error('\n❌ smoke test failed:', err);
  await closeContext().catch(() => {});
  process.exit(1);
});
