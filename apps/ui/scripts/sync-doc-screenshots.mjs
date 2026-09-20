#!/usr/bin/env node
/* global console, process */
// Copies the curated screenshots listed in tests/visual/doc-screenshots.json
// out of apps/ui/screenshots/ (gitignored Playwright scratch output) into
// the committed docs/images/ui/, compressing each one to WebP so the repo
// doesn't carry full-size PNG screenshots. Run this after `pnpm screenshots`
// has (re)generated the source PNGs for any changed page/state - see the
// doc-screenshot-sync skill.

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const uiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(uiRoot));
const outDir = join(repoRoot, 'docs', 'images', 'ui');
const webpQuality = 80;
// Docs are read at well under full desktop resolution - downscale before
// compressing so text-heavy screenshots (manuscript reader, story bible)
// don't carry 1440px of detail nobody's zooming in to see.
const maxWidth = 1280;

const manifest = JSON.parse(readFileSync(join(uiRoot, 'tests', 'visual', 'doc-screenshots.json'), 'utf8'));

mkdirSync(outDir, { recursive: true });

const missing = [];
const results = [];

for (const entry of manifest) {
  const sourcePath = join(uiRoot, 'screenshots', 'app', entry.page, entry.state, `${entry.viewport}.png`);
  if (!existsSync(sourcePath)) {
    missing.push(entry);
    continue;
  }

  const outPath = join(outDir, `${entry.docName}.webp`);
  const sourceBytes = statSync(sourcePath).size;
  await sharp(sourcePath).resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: webpQuality }).toFile(outPath);
  const outBytes = statSync(outPath).size;
  results.push({ docName: entry.docName, sourceBytes, outBytes });
}

for (const { docName, sourceBytes, outBytes } of results) {
  const savedPct = Math.round((1 - outBytes / sourceBytes) * 100);
  console.log(`${docName}.webp: ${(sourceBytes / 1024).toFixed(0)}KB -> ${(outBytes / 1024).toFixed(0)}KB (-${savedPct}%)`);
}

if (missing.length > 0) {
  console.error('\nMissing source screenshots for:');
  for (const entry of missing) {
    console.error(`  ${entry.page}/${entry.state}/${entry.viewport} (docName: ${entry.docName})`);
  }
  console.error('\nRun `pnpm screenshots` (optionally filtered with -g "<page> / <state>") to generate them first.');
  process.exit(1);
}

console.log(`\nSynced ${results.length} screenshot(s) into docs/images/ui/.`);
