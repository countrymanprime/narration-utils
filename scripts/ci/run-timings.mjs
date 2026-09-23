#!/usr/bin/env node
// Prints where a GitHub Actions run spent its time: the run's wall clock, and per job when it started after the run was
// created (queueing), how long it ran and on which runner; with --steps, every step of every job too. It is the Evidence
// table of the CI pipeline speed work (docs/operations/ci-and-releases.md "CI performance"), for any run id:
//
//   node scripts/ci/run-timings.mjs <run-id> [--steps] [--repo owner/name]
//
// It reads the Actions API through an authenticated GitHub CLI (`gh api`), so it needs no token of its own.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const seconds = (from, to) => (from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 1000) : null);

/** 813 -> "13 m 33 s"; null (not started or not finished) -> "-". */
export function duration(total) {
  if (total === null || total === undefined) return '-';
  const minutes = Math.floor(total / 60);
  return minutes ? `${minutes} m ${total % 60} s` : `${total} s`;
}

/** @param {{created_at: string, updated_at: string, run_started_at?: string}} run  @param {Array<object>} jobs */
export function timings(run, jobs) {
  const rows = jobs
    .map((job) => ({
      name: job.name,
      runner: (job.labels ?? []).join(', ') || '-',
      conclusion: job.conclusion ?? job.status,
      queuedFor: seconds(run.created_at, job.started_at),
      ran: seconds(job.started_at, job.completed_at),
      steps: (job.steps ?? []).map((step) => ({ name: step.name, conclusion: step.conclusion ?? step.status, ran: seconds(step.started_at, step.completed_at) })),
    }))
    .sort((a, b) => (a.queuedFor ?? Infinity) - (b.queuedFor ?? Infinity) || a.name.localeCompare(b.name));
  const finished = jobs.map((job) => job.completed_at).filter(Boolean).sort();
  return { wallClock: seconds(run.created_at, finished.at(-1) ?? run.updated_at), rows };
}

/** A Markdown table, so the output pastes straight into a PRD or an issue. */
export function render({ wallClock, rows }, { steps = false } = {}) {
  const lines = [`Wall clock: ${duration(wallClock)}`, '', '| Job | Runner | Started after | Ran | Result |', '| --- | --- | --- | --- | --- |'];
  for (const row of rows) {
    lines.push(`| \`${row.name}\` | ${row.runner} | ${duration(row.queuedFor)} | ${duration(row.ran)} | ${row.conclusion} |`);
    if (steps) for (const step of row.steps) lines.push(`| &nbsp;&nbsp;${step.name} | | | ${duration(step.ran)} | ${step.conclusion} |`);
  }
  return lines.join('\n');
}

function gh(path) {
  return JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

function main(argv) {
  const runId = argv.find((arg) => /^\d+$/.test(arg));
  const repoIndex = argv.indexOf('--repo');
  const repo = repoIndex >= 0 ? argv[repoIndex + 1] : (process.env.GITHUB_REPOSITORY ?? 'countrymanprime/narration-utils');
  if (!runId) {
    console.error('Usage: run-timings.mjs <run-id> [--steps] [--repo owner/name]');
    process.exit(2);
  }
  const [run] = gh(`repos/${repo}/actions/runs/${runId}`);
  const jobs = gh(`repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`).flatMap((page) => page.jobs);
  console.log(render(timings(run, jobs), { steps: argv.includes('--steps') }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
