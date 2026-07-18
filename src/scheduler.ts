// ─── Scheduled posting ─────────────────────────────────────────────────────────
//
// Threads' web UI has no native scheduling, so we run our own: jobs are persisted
// to ~/.threads-mcp/scheduled.json and a poll loop publishes them when due. The
// hard limit of this (or ANY cookie/browser approach) is that a post can only be
// sent while THIS process is running — so:
//   • same-session / short horizons: works while your MCP client keeps the server up.
//   • past-due jobs: fire on the next startup (better late than never).
//   • long horizons (days): run the server as an always-on daemon (xvfb + systemd/pm2).
//
// Nothing here contacts Threads directly — it delegates to publishThread(), the
// same code path as the create_thread tool, so posts respect the write throttle.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { publishThread } from './tools/write.js';
import { isLoggedIn, debug } from './browser/session.js';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled';

export interface ScheduledJob {
  id: string;
  at: string; // ISO datetime the post should go out
  text?: string;
  media?: string[];
  createdAt: string;
  status: JobStatus;
  firedAt?: string;
  result?: string;
  error?: string;
}

const DIR = path.join(os.homedir(), '.threads-mcp');
const FILE = path.join(DIR, 'scheduled.json');
const POLL_MS = 20000;

let jobs: ScheduledJob[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

function load(): void {
  try {
    if (fs.existsSync(FILE)) {
      jobs = JSON.parse(fs.readFileSync(FILE, 'utf8')) as ScheduledJob[];
      // Any job left 'running' means we crashed mid-publish — retry it.
      for (const j of jobs) if (j.status === 'running') j.status = 'pending';
    }
  } catch (e) {
    debug(`scheduler: failed to load queue: ${e}`);
    jobs = [];
  }
}

function save(): void {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(jobs, null, 2));
  } catch (e) {
    debug(`scheduler: failed to save queue: ${e}`);
  }
}

/** Queue a new scheduled post. */
export function scheduleJob(input: { at: Date; text?: string; media?: string[] }): ScheduledJob {
  const job: ScheduledJob = {
    id: crypto.randomBytes(4).toString('hex'),
    at: input.at.toISOString(),
    text: input.text,
    media: input.media,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  jobs.push(job);
  save();
  return job;
}

/** Cancel a pending job. Returns the job (or undefined if not found). */
export function cancelJob(id: string): ScheduledJob | undefined {
  const job = jobs.find((j) => j.id === id);
  if (job && job.status === 'pending') {
    job.status = 'canceled';
    save();
  }
  return job;
}

/** All jobs, soonest first. */
export function listJobs(): ScheduledJob[] {
  return [...jobs].sort((a, b) => a.at.localeCompare(b.at));
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    const due = jobs.filter((j) => j.status === 'pending' && Date.parse(j.at) <= now);
    if (due.length === 0) return;
    // If the session is gone, leave jobs pending and retry once logged back in.
    if (!(await isLoggedIn())) {
      debug(`scheduler: ${due.length} job(s) due but not signed in — will retry`);
      return;
    }
    for (const job of due) {
      job.status = 'running';
      save();
      try {
        job.result = await publishThread({ text: job.text, media: job.media });
        job.status = 'done';
      } catch (e) {
        job.status = 'failed';
        job.error = e instanceof Error ? e.message : String(e);
      }
      job.firedAt = new Date().toISOString();
      save();
      debug(`scheduler: job ${job.id} → ${job.status}`);
    }
  } finally {
    ticking = false;
  }
}

/** Load the queue and start the poll loop. Safe to call once at startup. */
export function startScheduler(): void {
  if (timer) return;
  load();
  timer = setInterval(() => void tick(), POLL_MS);
  if (typeof (timer as { unref?: () => void }).unref === 'function')
    (timer as { unref: () => void }).unref();
  // Catch any past-due jobs shortly after boot (once the browser can warm up).
  setTimeout(() => void tick(), 5000);
  const pending = jobs.filter((j) => j.status === 'pending').length;
  debug(`scheduler: started (${jobs.length} job(s) in queue, ${pending} pending)`);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
