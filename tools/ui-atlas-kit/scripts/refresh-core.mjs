#!/usr/bin/env node
// apps/ui in this repo is the upstream of the kit's vendored core files. After changing one of them
// there, run this to copy it into plugin/templates/core (test/dogfood.test.mjs fails until you do).
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, '..', 'plugin', 'templates', 'core');
const UI = join(HERE, '..', '..', '..', 'apps', 'ui');

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
for (const file of walk(CORE)) {
  const rel = relative(CORE, file);
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(join(UI, rel), file);
  console.log(`refreshed ${rel.split('\\').join('/')}`);
}
