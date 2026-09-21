#!/usr/bin/env node

// Builds the desktop app with `wails build` and stamps its own version into it. CI (.github/actions/build-native) and a local
// build (apps/desktop/package.json) both run this, so the version a build reports never depends on who built it.
//
// The version is the root package.json's, the single source scripts/release/sync-version.mjs keeps every other place equal to. It
// is bare semver: a release candidate and its promotion are the same bytes (promote-release.yml re-publishes the files), so
// they cannot report different versions. Without the stamp the program reports 0.0.0-dev (apps/desktop/version.go).
//
// `-nsis` asks Wails for the Windows setup program (apps/desktop/build/windows/installer, docs/adr/0082). Wails only prints a warning, and
// exits 0, when makensis is not installed, so this script removes a setup program left by an earlier build before it runs Wails and
// fails after it when a requested one was not made.

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { WINDOWS_INSTALLER, requireInstaller } from './assets.mjs';
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

// Wails writes the program and the setup program to build/bin of the project the build runs in (apps/desktop).
const BIN_DIR = resolve('build', 'bin');

export function installerRequested(extra) {
  return extra.some((argument) => argument === '-nsis' || argument === '-nsis=true');
}

export function removeStaleInstaller(extra, binDir = BIN_DIR) {
  if (installerRequested(extra)) rmSync(join(binDir, WINDOWS_INSTALLER), { force: true });
}

export function assertInstallerBuilt(extra, binDir = BIN_DIR) {
  if (installerRequested(extra)) requireInstaller(binDir);
}

function main() {
  const version = readRootVersion(ROOT_PACKAGE);
  const extra = process.argv.slice(2);
  removeStaleInstaller(extra);
  const result = spawnSync('wails', buildArguments(version, extra), { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  try {
    assertInstallerBuilt(extra);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
