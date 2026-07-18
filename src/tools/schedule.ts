import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { scheduleJob, cancelJob, listJobs, type ScheduledJob } from '../scheduler.js';
import { withErrorHandling } from '../utils/errors.js';

type TextResult = { content: Array<{ type: 'text'; text: string }> };
const text = (t: string): TextResult => ({ content: [{ type: 'text', text: t }] });

/** Parse a relative duration like "45s", "30m", "2h", "3d" → milliseconds. */
function parseDuration(s: string): number | null {
  const m = s.trim().match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('s')) return n * 1000;
  if (unit.startsWith('m')) return n * 60_000;
  if (unit.startsWith('h')) return n * 3_600_000;
  return n * 86_400_000; // days
}

const STATUS_ICON: Record<ScheduledJob['status'], string> = {
  pending: '🕒',
  running: '⏳',
  done: '✅',
  failed: '❌',
  canceled: '🚫',
};

function renderJob(j: ScheduledJob): string {
  const when = new Date(j.at);
  const body = j.text ? `"${j.text.slice(0, 60)}${j.text.length > 60 ? '…' : ''}"` : '';
  const media = j.media?.length ? ` +${j.media.length} media` : '';
  const err = j.error ? `\n    ⚠️ ${j.error}` : '';
  return `${STATUS_ICON[j.status]} \`${j.id}\` — ${when.toLocaleString()} — ${j.status}\n    ${body}${media}${err}`;
}

export function registerScheduleTools(server: McpServer): void {
  // ── schedule_thread ──────────────────────────────────────────────────────────
  server.tool(
    'schedule_thread',
    'Schedule a text/media post to publish later. Give `at` (ISO datetime, e.g. "2026-07-14T20:00", ' +
      'interpreted in the server\'s local timezone unless you add an offset like "+07:00" or "Z") OR `in` ' +
      '(a duration like "30m", "2h", "1d"). ⚠️ The post only fires while THIS server is running; past-due ' +
      'jobs fire on the next startup. For long horizons, run the server as an always-on daemon. Local media ' +
      'file paths must still exist when the job fires.',
    {
      text: z
        .string()
        .max(500)
        .optional()
        .describe('Post text (max 500 chars). Optional if media is given.'),
      media: z
        .array(z.string())
        .max(20)
        .optional()
        .describe(
          'Local file paths and/or http(s) URLs — images and/or video. Resolved when the job fires.',
        ),
      at: z
        .string()
        .optional()
        .describe('Absolute time, ISO 8601 (e.g. "2026-07-14T20:00" or "2026-07-14T20:00+07:00").'),
      in: z.string().optional().describe('Relative delay from now, e.g. "45s", "30m", "2h", "3d".'),
    },
    async ({ text: body, media, at, in: inn }) => {
      return withErrorHandling(async () => {
        if (!body && !(media && media.length)) return text('❌ Provide `text`, `media`, or both.');

        let when: Date;
        if (at) {
          when = new Date(at);
          if (isNaN(when.getTime()))
            return text(`❌ Couldn't parse \`at\`="${at}". Use ISO 8601, e.g. 2026-07-14T20:00.`);
        } else if (inn) {
          const ms = parseDuration(inn);
          if (ms === null)
            return text(`❌ Couldn't parse \`in\`="${inn}". Use e.g. "30m", "2h", "1d".`);
          when = new Date(Date.now() + ms);
        } else {
          return text('❌ Provide either `at` (absolute time) or `in` (relative delay).');
        }
        if (when.getTime() < Date.now() - 60_000) {
          return text(`❌ That time (${when.toLocaleString()}) is in the past.`);
        }

        const job = scheduleJob({ at: when, text: body, media });
        const what =
          media && media.length
            ? `${body ? `"${body}" + ` : ''}${media.length} media`
            : `"${body}"`;
        return text(
          `🗓 Scheduled ${what}\n` +
            `   id: \`${job.id}\`  ·  fires: ${when.toLocaleString()}\n\n` +
            `_Reminder: this only publishes while the server is running (past-due jobs fire on next startup). ` +
            `Use \`list_scheduled\` / \`cancel_scheduled\` to manage it._`,
        );
      });
    },
  );

  // ── list_scheduled ───────────────────────────────────────────────────────────
  server.tool(
    'list_scheduled',
    'List scheduled posts and their status (pending / done / failed / canceled).',
    {},
    async () => {
      return withErrorHandling(async () => {
        const jobs = listJobs();
        if (jobs.length === 0) return text('No scheduled posts.');
        const pending = jobs.filter((j) => j.status === 'pending' || j.status === 'running');
        const other = jobs.filter((j) => j.status !== 'pending' && j.status !== 'running');
        const parts = ['🗓 **Scheduled posts**', ''];
        if (pending.length) parts.push('— Upcoming —', ...pending.map(renderJob));
        if (other.length) parts.push('', '— History —', ...other.slice(-10).map(renderJob));
        return text(parts.join('\n'));
      });
    },
  );

  // ── cancel_scheduled ─────────────────────────────────────────────────────────
  server.tool(
    'cancel_scheduled',
    'Cancel a pending scheduled post by its id (from schedule_thread / list_scheduled).',
    { id: z.string().describe('The job id to cancel') },
    async ({ id }) => {
      return withErrorHandling(async () => {
        const job = cancelJob(id);
        if (!job) return text(`❌ No scheduled post with id \`${id}\`.`);
        if (job.status === 'canceled') return text(`🚫 Canceled scheduled post \`${id}\`.`);
        return text(`ℹ️ Post \`${id}\` is already ${job.status} — nothing to cancel.`);
      });
    },
  );
}
