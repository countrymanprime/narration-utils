#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const candidate = process.argv[2] ?? process.env.RELEASE_TAG;
if (!candidate) throw new Error('Provide a candidate tag as an argument or RELEASE_TAG.');
const stableTags = execFileSync('git', ['tag', '--list', 'v[0-9]*', '--sort=-version:refname'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((tag) => tag && !tag.includes('-'));
const previous = stableTags.find((tag) => tag !== candidate) ?? '';
const range = previous ? `${previous}..${candidate}` : candidate;
const rows = execFileSync('git', ['log', '--format=%h%x1f%s', range], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .map((row) => row.split('\x1f'));
const sections = new Map([['feat', 'Features'], ['fix', 'Fixes'], ['perf', 'Performance'], ['refactor', 'Refactoring'], ['docs', 'Documentation'], ['other', 'Maintenance']]);
const grouped = new Map([...sections.keys()].map((key) => [key, []]));
for (const [sha, subject] of rows) {
  const match = subject.match(/^([a-z]+)(?:\([^)]*\))?!?:\s+(.+)$/);
  const type = match?.[1] ?? 'other';
  const key = grouped.has(type) ? type : 'other';
  grouped.get(key).push(`- ${match?.[2] ?? subject} (${sha})`);
}
const output = [`# ${candidate}`, ''];
for (const [key, title] of sections) {
  const entries = grouped.get(key);
  if (entries.length) output.push(`## ${title}`, '', ...entries, '');
}
// Every asset is attested by the release workflow (docs/adr/0071); say how a narrator checks one.
const repository = process.env.GITHUB_REPOSITORY || '<owner>/<repo>';
output.push(
  '## Verifying this download',
  '',
  `Each file on this release has build provenance from this repository's release workflow. With the [GitHub CLI](https://cli.github.com): \`gh attestation verify <file> --repo ${repository}\`. The \`.sha256\` beside each file only detects a damaged download.`,
  '',
);
const notes = `${output.join('\n').trim()}\n`;
const destination = process.env.RELEASE_NOTES_FILE ?? 'release-notes.md';
writeFileSync(destination, notes);
if (process.env.GITHUB_STEP_SUMMARY && process.env.GITHUB_STEP_SUMMARY !== destination) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, notes);
}
