/**
 * Latency harness for captureGraphqlBatch.
 *
 * Serves a page shaped like a Threads profile — post data server-rendered into
 * <script type="application/json">, plus a lazy XHR that lands ~2.5s later —
 * then measures capture with and without a sufficiency predicate. No Threads
 * account involved; this exercises the ordering logic only.
 */
import http from 'node:http';
import { captureGraphqlBatch, closeContext } from '../src/browser/session.js';
import { extractPosts } from '../src/api/extract.js';

function post(i: number) {
  return {
    pk: String(i),
    code: `CODE${i}`,
    caption: { text: `server-rendered post ${i}` },
    user: { username: 'alice', pk: 'u1' },
    like_count: i,
    taken_at: Math.floor(Date.now() / 1000) - i * 60,
  };
}

// 20 posts embedded in the HTML, exactly how Threads ships the first page.
const embedded = {
  data: {
    feedData: {
      edges: Array.from({ length: 20 }, (_, i) => ({
        node: { id: `n${i}`, thread_items: [{ post: post(i) }] },
      })),
    },
  },
};

const html = `<!doctype html><html><head><title>fake profile</title></head><body>
<script type="application/json">${JSON.stringify(embedded)}</script>
<div id="feed">feed</div>
<script>
  // A lazy secondary query, like the side-nav/pagination ones: lands late.
  setTimeout(function () {
    fetch('/api/graphql', { method: 'POST', body: 'fb_api_req_friendly_name=ProfileThreadsTab' });
  }, 2500);
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url?.includes('graphql')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: { lazy: true } }));
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end(html);
});

async function timed(label: string, fn: () => Promise<unknown[]>) {
  const t0 = Date.now();
  const bodies = await fn();
  const ms = Date.now() - t0;
  const posts = extractPosts(bodies);
  console.log(
    `${label.padEnd(34)} ${String(ms).padStart(6)}ms   bodies=${String(bodies.length).padStart(2)}  posts=${posts.length}`,
  );
  return ms;
}

async function main() {
  await new Promise<void>((r) => server.listen(3999, '127.0.0.1', r));
  const url = 'http://127.0.0.1:3999/';

  console.log('\nasking for 15 posts — the page embeds 20\n');

  // Old behaviour: fixed dwell, embedded harvested only at the end.
  const before = await timed('no predicate (fixed 4s dwell)', () =>
    captureGraphqlBatch(url, { friendlyName: 'NeverMatches', dwellMs: 4000 }),
  );

  // New behaviour: embedded read first, predicate satisfied immediately.
  const after = await timed('with enough() predicate', () =>
    captureGraphqlBatch(url, {
      friendlyName: 'NeverMatches',
      dwellMs: 4000,
      enough: (b) => extractPosts(b).length >= 15,
    }),
  );

  // A scroll trigger that should be skipped outright when already satisfied.
  let scrolled = false;
  const skipped = await timed('skippable trigger, already satisfied', () =>
    captureGraphqlBatch(
      url,
      {
        friendlyName: 'NeverMatches',
        dwellMs: 4000,
        enough: (b) => extractPosts(b).length >= 15,
        triggerSkippable: true,
      },
      async (p) => {
        scrolled = true;
        await p.waitForTimeout(3000);
      },
    ),
  );
  console.log(`\ntrigger actually ran: ${scrolled}  (expected false — it was skipped)`);
  console.log(
    `saving: ${before - after}ms on dwell, ${before - skipped}ms including the skipped scroll`,
  );
  console.log(`speedup: ${(before / after).toFixed(1)}x / ${(before / skipped).toFixed(1)}x\n`);

  server.close();
  await closeContext();
}

main().catch(async (e) => {
  console.error(e);
  server.close();
  await closeContext().catch(() => {});
  process.exit(1);
});
