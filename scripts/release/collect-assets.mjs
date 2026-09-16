#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const output = resolve(process.env.RELEASE_ASSETS_DIR ?? 'release-assets');
const roots = (process.env.BUNDLE_DIRS ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
if (!roots.length) throw new Error('BUNDLE_DIRS must name one or more Tauri bundle output directories.');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const extensions = new Set(['.exe', '.msi', '.dmg', '.appimage', '.deb']);
const assets = [];
function visit(path) {
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    const stat = statSync(child);
    if (stat.isDirectory()) visit(child);
    else if (extensions.has(child.slice(child.lastIndexOf('.')).toLowerCase())) {
      const target = join(output, basename(child));
      cpSync(child, target);
      assets.push(target);
    }
  }
}
for (const root of roots) {
  if (!existsSync(root)) throw new Error(`Missing bundle output: ${root}`);
  visit(root);
}
if (!assets.length) throw new Error('No installer assets were found.');
const sums = assets.sort().map((file) => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${basename(file)}`);
writeFileSync(join(output, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `assets_dir=${output}\n`, { flag: 'a' });
