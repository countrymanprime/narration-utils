import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WINDOWS_INSTALLER } from './assets.mjs';
import {
  assertInstallerBuilt,
  buildAssetsArguments,
  goBuildArguments,
  goosOf,
  installerRequested,
  programName,
  removeStaleInstaller,
  versionFlag,
  withFourPartManifestVersion,
} from './wails-build.mjs';

test('the version flag stamps a bare semver into the Go variable the app reports', () => {
  assert.equal(versionFlag('0.2.7'), '-X main.version=0.2.7');
});

test('a release candidate and its promotion are the same bytes, so a version with a suffix is refused', () => {
  for (const bad of ['0.2.7-rc', 'v0.2.7', '0.2', '', '0.2.7 ', '1.2.3; rm -rf /', '0.2.7\n']) {
    assert.throws(() => versionFlag(bad), /bare semver/, JSON.stringify(bad));
  }
});

const product = JSON.parse(readFileSync(new URL('../../apps/desktop/wails.json', import.meta.url), 'utf8'));

test('the Go build is a production build that always stamps the version', () => {
  assert.deepEqual(goBuildArguments('0.2.7', 'linux', 'build/bin/narration-utils'), [
    'build',
    '-tags',
    'production',
    '-trimpath',
    '-buildvcs=false',
    '-ldflags',
    '-w -s -X main.version=0.2.7',
    '-o',
    'build/bin/narration-utils',
    '.',
  ]);
});

// Without -H windowsgui a console window opens beside the app, and without the production tag WebView2's DevTools stay on.
test('the Windows program is a window program with no console', () => {
  const args = goBuildArguments('0.2.7', 'windows', 'build/bin/narration-utils.exe');
  assert.equal(args[args.indexOf('-ldflags') + 1], '-w -s -H windowsgui -X main.version=0.2.7');
  assert.equal(args[args.indexOf('-tags') + 1], 'production');
});

test('a version with a suffix never reaches the Go build', () => {
  assert.throws(() => goBuildArguments('0.2.7-rc', 'windows', 'x.exe'), /bare semver/);
});

// The REAPER launcher, the updater and the installer all look for exactly this name (docs/adr/0073).
test('the program is narration-utils, with .exe on Windows only', () => {
  assert.equal(programName(product, 'windows'), 'narration-utils.exe');
  assert.equal(programName(product, 'linux'), 'narration-utils');
  assert.equal(programName(product, 'darwin'), 'narration-utils');
});

test('each platform builds for itself', () => {
  assert.equal(goosOf('win32'), 'windows');
  assert.equal(goosOf('darwin'), 'darwin');
  assert.equal(goosOf('linux'), 'linux');
  assert.throws(() => goosOf('freebsd'), /not built on freebsd/);
});

test('the rendered build assets carry the product facts of wails.json and the release version', () => {
  const args = buildAssetsArguments(product, '0.2.7', '/tmp/assets');
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.deepEqual(args.slice(0, 2), ['update', 'build-assets']);
  assert.equal(value('-dir'), '/tmp/assets');
  assert.equal(value('-binaryname'), 'narration-utils');
  assert.equal(value('-productname'), product.info.productName);
  assert.equal(value('-productcompany'), product.info.companyName);
  assert.equal(value('-productcopyright'), product.info.copyright);
  assert.equal(value('-productidentifier'), product.info.productIdentifier);
  assert.equal(value('-productversion'), '0.2.7');
});

test('a wails.json without a product fact the rendered files need is refused', () => {
  assert.throws(() => buildAssetsArguments({ outputfilename: 'narration-utils', info: { productName: 'N' } }, '0.2.7', '/tmp'), /info\.companyName/);
});

// Wails v3's manifest template writes the product version as it is, and Windows refuses to start a program whose manifest
// assemblyIdentity version is not four numbers.
test('the Windows manifest gets the four-part version Windows requires', () => {
  const manifest =
    '<assembly>\n    <assemblyIdentity type="win32" name="com.narrationutils.app" version="0.2.7" processorArchitecture="*"/>\n' +
    '    <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*"/>\n</assembly>';
  const fixed = withFourPartManifestVersion(manifest, '0.2.7');
  assert.match(fixed, /name="com\.narrationutils\.app" version="0\.2\.7\.0"/);
  assert.match(fixed, /Common-Controls" version="6\.0\.0\.0"/);
  assert.throws(() => withFourPartManifestVersion('<assembly/>', '0.2.7'), /no assemblyIdentity/);
});

test('an installer is expected exactly when the build was asked for one', () => {
  assert.equal(installerRequested(['--installer']), true);
  assert.equal(installerRequested([]), false);
  assert.equal(installerRequested(['-nsis']), false);
  assert.equal(installerRequested(['--', 'installer']), false);
});

test('a build that asked for an installer and made none fails and says how to get makensis', () => {
  const bin = mkdtempSync(join(tmpdir(), 'wails-bin-'));

  assert.throws(() => assertInstallerBuilt(['--installer'], bin), /narration-utils-windows-x64-setup\.exe.*makensis/s);
});

test('a build that asked for an installer and made it passes', () => {
  const bin = mkdtempSync(join(tmpdir(), 'wails-bin-'));
  writeFileSync(join(bin, WINDOWS_INSTALLER), 'setup');

  assert.doesNotThrow(() => assertInstallerBuilt(['--installer'], bin));
});

test('a build that did not ask for an installer needs none', () => {
  assert.doesNotThrow(() => assertInstallerBuilt([], mkdtempSync(join(tmpdir(), 'wails-bin-'))));
});

// A setup program left by an earlier build must not satisfy the check for this one.
test('an installer left by an earlier build is removed before the build so it cannot stand in for this one', () => {
  const bin = mkdtempSync(join(tmpdir(), 'wails-bin-'));
  writeFileSync(join(bin, WINDOWS_INSTALLER), 'stale');

  removeStaleInstaller(['--installer'], bin);
  assert.equal(existsSync(join(bin, WINDOWS_INSTALLER)), false);

  writeFileSync(join(bin, WINDOWS_INSTALLER), 'kept');
  removeStaleInstaller([], bin);
  assert.equal(existsSync(join(bin, WINDOWS_INSTALLER)), true);
});
