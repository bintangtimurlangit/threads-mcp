import {
  ThreadsAPIError,
  ThreadsAuthRequiredError,
  ThreadsRateLimitedError,
} from '../api/client.js';

type TextResult = { content: Array<{ type: 'text'; text: string }> };

/**
 * Wraps a tool handler to return a clean MCP error content block
 * instead of throwing and crashing the server.
 */
export async function withErrorHandling(fn: () => Promise<TextResult>): Promise<TextResult> {
  try {
    return await fn();
  } catch (err) {
    let message: string;

    if (err instanceof ThreadsAuthRequiredError) {
      message =
        '🔒 Not signed in to Threads (or the session expired).\n\n' +
        'Run this once in the project folder:\n' +
        '`npm run login`\n\n' +
        'A Chromium window opens — log into Threads with your Instagram account, then come ' +
        'back and press Enter. The session is saved and reused; retry your request afterwards.';
    } else if (err instanceof ThreadsRateLimitedError) {
      message =
        '🐢 Threads rate-limited this request.\n\n' +
        'Stop automating for a few minutes, then slow down. Meta restricts accounts that ' +
        'behave like bots — space out posts, likes, and follows.';
    } else if (err instanceof ThreadsAPIError) {
      message = `❌ Threads Error: ${err.message}`;
    } else if (err instanceof Error) {
      message = `❌ Error: ${err.message}`;
    } else {
      message = `❌ Unknown error occurred`;
    }

    return { content: [{ type: 'text', text: message }] };
  }
}

/** Truncate text to max chars. */
export function truncate(text: string, maxLen = 280): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…';
}

/** Compact large counts: 1234 → "1.2K", 1_200_000 → "1.2M". */
export function compact(n: number | undefined | null): string {
  if (n === undefined || n === null) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
