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
// The first stable release is unsigned (owner decision D7), and Windows shows a warning for a program it does not know. Say so
// before a narrator meets it. The names are the release assets (scripts/release/assets.mjs).
output.push(
  '## Installing on Windows',
  '',
  'Download `narration-utils-windows-x64-setup.exe` and run it. It installs Narration Utils for your user account only (no administrator prompt) and adds a Start Menu entry (plus **Narration Utils for Audacity**, which opens the app ready for an Audacity 3.x project) and, if you leave it ticked, a desktop shortcut. Uninstall it from Settings > Apps; that removes the program and the shortcuts and leaves your settings, your downloaded voices and models and your project folders alone.',
  '',
  'This release is **unsigned**. Windows SmartScreen may say it "prevented an unrecognized app from starting": choose **More info**, then **Run anyway**. That warning is about the missing signature, not about a problem found in the file; to check the file came from this repository, follow the steps below.',
  '',
  'Once installed, the app updates itself from these releases after you click **Install and restart** (Settings > About & updates). `narration-utils-windows-x64.zip` is that update package, not something to run by hand.',
  '',
);
// The program is AGPL-3.0-or-later (docs/adr/0039) and bundles GPL-family components, so the licences and the source offer are their own asset
// (scripts/release/assets.mjs, scripts/licenses/notices.py).
output.push(
  '## Licences and source',
  '',
  'Narration Utils is free software under the AGPL-3.0-or-later licence. `THIRD-PARTY-NOTICES.txt` on this release lists every third-party component in the program with its licence and licence text, includes the full AGPL text, and says where the complete source of this release is: this repository, at the tag this release was built from.',
  '',
);
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
