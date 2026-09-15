#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const checkOnly = process.argv.includes('--check');
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
const version = rootPackage.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  throw new Error(`Root package version is not valid SemVer: ${version}`);
}

let changed = false;
function updateJson(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value.version === version) return;
  if (checkOnly) throw new Error(`${file} is ${value.version}; expected ${version}`);
  value.version = version;
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  changed = true;
}

function updatePackageLock(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value.packages?.['']?.version === version && value.version === version) return;
  if (checkOnly) throw new Error(`${file} does not match ${version}`);
  value.version = version;
  if (value.packages?.['']) value.packages[''].version = version;
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  changed = true;
}

function replaceVersion(file, pattern) {
  const before = readFileSync(file, 'utf8');
  const match = before.match(pattern);
  if (!match) {
    if (checkOnly) throw new Error(`${file} does not contain the expected version declaration`);
    throw new Error(`Could not synchronize ${file}`);
  }
  const after = before.replace(pattern, `$1${version}$2`);
  if (before === after) return;
  if (checkOnly) throw new Error(`${file} does not match ${version}`);
  writeFileSync(file, after);
  changed = true;
}

updateJson('shared/ui/package.json');
updatePackageLock('package-lock.json');
updatePackageLock('shared/ui/package-lock.json');
updateJson('shell/package.json');
updateJson('shell/src-tauri/tauri.conf.json');
replaceVersion('shell/src-tauri/Cargo.toml', /(^version\s*=\s*")[^"]+("\s*$)/m);
replaceVersion('shared/manuscript-import/Cargo.toml', /(^version\s*=\s*")[^"]+("\s*$)/m);

// Cargo records local package versions in the lockfile. Updating them here
// keeps `cargo --locked` deterministic without resolving the dependency graph.
for (const name of ['narration-utils-shell', 'manuscript-import']) {
  replaceVersion('Cargo.lock', new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = ")[^"]+("\\r?\\n)`));
}

if (!checkOnly && changed) console.log(`Synchronized release version ${version}.`);
