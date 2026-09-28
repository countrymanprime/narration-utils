#!/usr/bin/env node
// Runs markdownlint-cli2 over only the Markdown files a change adds or modifies against a base ref (ADR 0415):
// `pnpm lint:md` / `pnpm lint:md:fix` locally, and `Docs / Markdown lint (changed files)`
// (.github/workflows/docs.yml) in CI, which sets GITHUB_BASE_REF and passes --summary.
//
// --fix       run markdownlint-cli2 --fix first (what `pnpm lint:md:fix` passes)
// --base REF  compare against REF instead of origin/main (or $GITHUB_BASE_REF in CI)
// --summary   append a job summary to $GITHUB_STEP_SUMMARY when it is set (CI only)

import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { changedMarkdownFiles } from './changed-markdown.mjs';

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const summary = args.includes('--summary');
const baseFlagIndex = args.indexOf('--base');
const base = baseFlagIndex !== -1 ? args[baseFlagIndex + 1] : process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';

function writeSummary(text) {
  if (summary && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

const files = changedMarkdownFiles({ base });

if (files.length === 0) {
  console.log(`No Markdown files changed against ${base}.`);
  writeSummary('### Markdown lint (changed files)\n\nNo Markdown files changed.\n');
  process.exit(0);
}

console.log(`Linting ${files.length} Markdown file(s) changed against ${base}:\n${files.map((file) => `  ${file}`).join('\n')}`);

const bin = process.platform === 'win32' ? 'node_modules\\.bin\\markdownlint-cli2.cmd' : 'node_modules/.bin/markdownlint-cli2';
const result = spawnSync(bin, [...(fix ? ['--fix'] : []), ...files], { stdio: 'inherit' });

if (result.status === 0) {
  writeSummary(`### Markdown lint (changed files)\n\n${files.length} file(s) checked against \`${base}\`, no violations.\n`);
} else {
  writeSummary(
    `### Markdown lint (changed files)\n\n${files.length} file(s) checked against \`${base}\`, violations found (see the step log above).\n\nRun \`pnpm lint:md:fix\` locally, then commit the result, to fix what can be auto-fixed.\n`,
  );
}

process.exit(result.status ?? 1);
