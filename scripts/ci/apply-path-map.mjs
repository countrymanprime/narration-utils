#!/usr/bin/env node

// Rewrites retired repo paths to their new locations, using the map in layout.json.
//
//   node scripts/ci/apply-path-map.mjs            rewrite every tracked text file in place
//   node scripts/ci/apply-path-map.mjs --check    list what would change and exit 1 if anything would
//   node scripts/ci/apply-path-map.mjs a.md b.ts  limit the run to the named repo-relative files
//
// Use it after merging main into a branch that predates a layout move: git follows the renames
// but not the path text inside files. Accepted ADRs and the lockfile are historical and skipped.

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { applyPathMap, isHistorical, loadLayout, readTrackedText, REPO_ROOT, trackedFiles } from './layout.mjs';

function main(args) {
  const check = args.includes('--check');
  const named = args.filter((arg) => !arg.startsWith('--'));
  const { renames, historical } = loadLayout();
  const files = named.length ? named : trackedFiles();
  const changed = [];
  for (const [file, text] of readTrackedText(files.filter((file) => !isHistorical(file, historical)))) {
    const next = applyPathMap(text, renames);
    if (next === text) continue;
    changed.push(file);
    if (!check) writeFileSync(join(REPO_ROOT, file), next);
  }
  for (const file of changed) console.log(`${check ? 'would change' : 'updated'} ${file}`);
  if (check && changed.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
