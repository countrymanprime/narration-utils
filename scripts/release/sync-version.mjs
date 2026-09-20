#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function readRootVersion(file = 'package.json') {
  const rootPackage = JSON.parse(readFileSync(file, 'utf8'));
  const version = rootPackage.version;
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Root package version is not valid SemVer: ${version}`);
  }
  return version;
}

export function updateJson(file, version, checkOnly) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value.version === version) return false;
  if (checkOnly) throw new Error(`${file} is ${value.version}; expected ${version}`);
  value.version = version;
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return true;
}

export function updateWailsJsonVersion(file, version, checkOnly) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  const current = value.info?.productVersion;
  if (current === version) return false;
  if (checkOnly) throw new Error(`${file} is ${current}; expected ${version}`);
  value.info = { ...value.info, productVersion: version };
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return true;
}

function replaceVersion(file, pattern, version, checkOnly) {
  const before = readFileSync(file, 'utf8');
  const match = before.match(pattern);
  if (!match) {
    if (checkOnly) throw new Error(`${file} does not contain the expected version declaration`);
    throw new Error(`Could not synchronize ${file}`);
  }
  const after = before.replace(pattern, `$1${version}$2`);
  if (before === after) return false;
  if (checkOnly) throw new Error(`${file} does not match ${version}`);
  writeFileSync(file, after);
  return true;
}

export function syncVersion(checkOnly) {
  const version = readRootVersion();
  const changed = [
    updateJson('apps/ui/package.json', version, checkOnly),
    updateJson('apps/desktop/package.json', version, checkOnly),
    updateWailsJsonVersion('apps/desktop/wails.json', version, checkOnly),
  ].some(Boolean);
  if (!checkOnly && changed) console.log(`Synchronized release version ${version}.`);
}

function main() {
  syncVersion(process.argv.includes('--check'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
