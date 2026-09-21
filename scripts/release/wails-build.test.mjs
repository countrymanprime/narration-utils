import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WINDOWS_INSTALLER } from './assets.mjs';
import { assertInstallerBuilt, buildArguments, installerRequested, removeStaleInstaller, versionFlag } from './wails-build.mjs';

test('the version flag stamps a bare semver into the Go variable the app reports', () => {
  assert.equal(versionFlag('0.2.7'), '-X main.version=0.2.7');
});

test('a release candidate and its promotion are the same bytes, so a version with a suffix is refused', () => {
  for (const bad of ['0.2.7-rc', 'v0.2.7', '0.2', '', '0.2.7 ', '1.2.3; rm -rf /', '0.2.7\n']) {
    assert.throws(() => versionFlag(bad), /bare semver/, JSON.stringify(bad));
  }
});

test('the build always stamps the version and passes the caller arguments through', () => {
  assert.deepEqual(buildArguments('0.2.7', ['-s', '-tags', 'webkit2_41']), ['build', '-ldflags', '-X main.version=0.2.7', '-s', '-tags', 'webkit2_41']);
  assert.deepEqual(buildArguments('0.2.7', []), ['build', '-ldflags', '-X main.version=0.2.7']);
});

test('a leading separator that a package script leaves in front of the arguments is dropped', () => {
  assert.deepEqual(buildArguments('0.2.7', ['--', '-platform', 'windows/amd64']), ['build', '-ldflags', '-X main.version=0.2.7', '-platform', 'windows/amd64']);
});

test('the caller may not replace the version stamp with ldflags of its own', () => {
  assert.throws(() => buildArguments('0.2.7', ['-ldflags', '-X main.version=9.9.9']), /ldflags/);
});

// `wails build -nsis` only warns, and exits 0, when makensis is not installed, so the build script has to look for what it asked for.
test('an installer is expected exactly when the build was asked for one', () => {
  assert.equal(installerRequested(['-s', '-nsis']), true);
  assert.equal(installerRequested(['-nsis=true']), true);
  assert.equal(installerRequested(['--nsis']), true);
  assert.equal(installerRequested(['-nsis=1']), true);
  assert.equal(installerRequested(['-nsis=0']), false);
  assert.equal(installerRequested(['-s']), false);
  assert.equal(installerRequested(['-nsis=false']), false);
  assert.equal(installerRequested(['-tags', 'nsis']), false);
});

test('a build that asked for an installer and made none fails and says how to get makensis', () => {
  const bin = mkdtempSync(join(tmpdir(), 'wails-bin-'));

  assert.throws(() => assertInstallerBuilt(['-s', '-nsis'], bin), /narration-utils-windows-x64-setup\.exe.*makensis/s);
});

test('a build that asked for an installer and made it passes', () => {
  const bin = mkdtempSync(join(tmpdir(), 'wails-bin-'));
  writeFileSync(join(bin, WINDOWS_INSTALLER), 'setup');

  assert.doesNotThrow(() => assertInstallerBuilt(['-s', '-nsis'], bin));
});

test('a build that did not ask for an installer needs none', () => {
  assert.doesNotThrow(() => assertInstallerBuilt(['-s'], mkdtempSync(join(tmpdir(), 'wails-bin-'))));
});

// A setup program left by an earlier build must not satisfy the check for this one.
test('an installer left by an earlier build is removed before the build so it cannot stand in for this one', () => {
  const bin = mkdtempSync(join(tmpdir(), 'wails-bin-'));
  writeFileSync(join(bin, WINDOWS_INSTALLER), 'stale');

  removeStaleInstaller(['-s', '-nsis'], bin);
  assert.equal(existsSync(join(bin, WINDOWS_INSTALLER)), false);

  writeFileSync(join(bin, WINDOWS_INSTALLER), 'kept');
  removeStaleInstaller(['-s'], bin);
  assert.equal(existsSync(join(bin, WINDOWS_INSTALLER)), true);
});
