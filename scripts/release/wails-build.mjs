#!/usr/bin/env node

// Builds the desktop app with `wails build` and stamps its own version into it. CI (.github/actions/build-native) and a local
// build (apps/desktop/package.json) both run this, so the version a build reports never depends on who built it.
//
// The version is the root package.json's, the single source scripts/release/sync-version.mjs keeps every other place equal to. It
// is bare semver: a release candidate and its promotion are the same bytes (promote-release.yml re-publishes the files), so
// they cannot report different versions. Without the stamp the program reports 0.0.0-dev (apps/desktop/version.go).

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readRootVersion } from './sync-version.mjs';

const BARE_SEMVER = /^\d+\.\d+\.\d+$/;
const ROOT_PACKAGE = resolve(import.meta.dirname, '..', '..', 'package.json');

export function versionFlag(version) {
  if (!BARE_SEMVER.test(version)) throw new Error(`The app version must be bare semver (for example 0.2.7); got ${JSON.stringify(version)}`);
  return `-X main.version=${version}`;
}

export function buildArguments(version, extra) {
  const passed = extra[0] === '--' ? extra.slice(1) : extra;
  if (passed.some((argument) => argument === '-ldflags' || argument.startsWith('-ldflags='))) {
    throw new Error('Pass no -ldflags: this script sets them so the build carries its version');
  }
  return ['build', '-ldflags', versionFlag(version), ...passed];
}

function main() {
  const version = readRootVersion(ROOT_PACKAGE);
  const result = spawnSync('wails', buildArguments(version, process.argv.slice(2)), { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
