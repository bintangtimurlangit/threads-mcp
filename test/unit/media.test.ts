import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Limits are read at import time, so set small ones first.
process.env.THREADS_MAX_MEDIA_BYTES = String(64 * 1024); // 64KB
process.env.THREADS_MEDIA_TIMEOUT_MS = '600';
const { resolveMediaFiles } = await import('../../src/tools/write.js');

let base = '';
let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/ok.jpg') {
      res.setHeader('content-type', 'image/jpeg');
      res.end(Buffer.alloc(1024, 1));
    } else if (url === '/huge.jpg') {
      // No content-length: forces the running byte count to do the enforcing.
      res.setHeader('content-type', 'image/jpeg');
      for (let i = 0; i < 40; i++) res.write(Buffer.alloc(8 * 1024, 1));
      res.end();
    } else if (url === '/declared-huge.jpg') {
      res.setHeader('content-type', 'image/jpeg');
      res.setHeader('content-length', String(10 * 1024 * 1024));
      res.end(Buffer.alloc(1024));
    } else if (url === '/login.html') {
      res.setHeader('content-type', 'text/html');
      res.end('<html>sign in</html>');
    } else if (url === '/slow.jpg') {
      res.setHeader('content-type', 'image/jpeg');
      // Never finishes — the timeout has to fire.
    } else if (url === '/404') {
      res.statusCode = 404;
      res.end('nope');
    } else {
      res.statusCode = 500;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => server.close());

async function rejectsWith(entry: string, re: RegExp) {
  await assert.rejects(
    () => resolveMediaFiles([entry]),
    (e: Error) => {
      assert.match(e.message, re);
      return true;
    },
  );
}

describe('resolveMediaFiles', () => {
  test('downloads a well-formed image', async () => {
    const { paths, temps } = await resolveMediaFiles([`${base}/ok.jpg`]);
    assert.equal(paths.length, 1);
    assert.ok(fs.existsSync(paths[0]));
    assert.match(paths[0], /\.jpg$/, 'extension derived from content-type');
    for (const t of temps) fs.rmSync(t, { force: true });
  });

  test('caps a response that lies about (omits) its length', async () => {
    await rejectsWith(`${base}/huge.jpg`, /exceeded the .*limit while downloading/);
  });

  test('rejects an oversized file before downloading it', async () => {
    await rejectsWith(`${base}/declared-huge.jpg`, /over the .*limit/);
  });

  test('rejects a non-media content type', async () => {
    // The common real failure: a URL that 200s with an HTML login page, which
    // used to land on disk as ".jpg" and fail opaquely inside the composer.
    await rejectsWith(`${base}/login.html`, /not an image or video/);
  });

  test('times out instead of hanging the write lock', async () => {
    await rejectsWith(`${base}/slow.jpg`, /timed out after/);
  });

  test('surfaces an HTTP error', async () => {
    await rejectsWith(`${base}/404`, /HTTP 404/);
  });

  test('reports a missing local file', async () => {
    await rejectsWith('/definitely/not/here.jpg', /Media file not found/);
  });

  test('rejects an oversized local file', async () => {
    const big = path.join(os.tmpdir(), `threads-mcp-test-${Date.now()}.jpg`);
    fs.writeFileSync(big, Buffer.alloc(128 * 1024));
    try {
      await rejectsWith(big, /over the .*limit/);
    } finally {
      fs.rmSync(big, { force: true });
    }
  });

  test('cleans up earlier temp files when a later entry fails', async () => {
    // Otherwise a two-item list that fails on the second leaks the first: the
    // caller's cleanup only runs for a list it successfully received.
    let leaked: string[] = [];
    try {
      await resolveMediaFiles([`${base}/ok.jpg`, `${base}/login.html`]);
      assert.fail('expected rejection');
    } catch {
      leaked = fs
        .readdirSync(os.tmpdir())
        .filter((f) => f.startsWith('threads-mcp-') && f.endsWith('.jpg'));
    }
    assert.equal(leaked.length, 0, `leaked temp files: ${leaked.join(', ')}`);
  });
});
