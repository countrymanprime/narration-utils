import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { PLATFORMS, assetName, checksumName, packageAsset, sha256File, verifyAssets } from './assets.mjs';

const scratch = (prefix) => mkdtempSync(join(tmpdir(), `${prefix}-`));
const hasTool = (name) => !spawnSync(name, ['--version'], { stdio: 'ignore' }).error;

function stageWailsOutput(files) {
  const bin = scratch('bin');
  for (const [name, body] of Object.entries(files)) {
    const path = join(bin, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
  }
  return bin;
}

test('every platform asset is narration-utils-<platform>.<ext>', () => {
  assert.equal(assetName('windows-x64'), 'narration-utils-windows-x64.exe');
  assert.equal(assetName('macos-arm64'), 'narration-utils-macos-arm64.zip');
  assert.equal(assetName('linux-x64'), 'narration-utils-linux-x64.tar.gz');
  assert.equal(checksumName('linux-x64'), 'narration-utils-linux-x64.tar.gz.sha256');
  assert.deepEqual(Object.keys(PLATFORMS), ['windows-x64', 'macos-arm64', 'linux-x64']);
});

test('assetName rejects a platform the release does not ship', () => {
  assert.throws(() => assetName('freebsd-x64'), /Unknown platform/);
});

test('windows packaging ships only the NSIS installer under the platform name', () => {
  const bin = stageWailsOutput({
    'narration-utils-shell.exe': 'raw shell',
    'narration-utils-shell-amd64-installer.exe': 'the installer',
  });
  const out = scratch('out');

  const asset = packageAsset({ platform: 'windows-x64', binDir: bin, outDir: out });

  assert.equal(asset, join(out, 'narration-utils-windows-x64.exe'));
  assert.equal(readFileSync(asset, 'utf8'), 'the installer');
});

test('windows packaging fails when the installer is missing or ambiguous', () => {
  const missing = stageWailsOutput({ 'narration-utils-shell.exe': 'raw shell' });
  assert.throws(() => packageAsset({ platform: 'windows-x64', binDir: missing, outDir: scratch('out') }), /installer/);

  const ambiguous = stageWailsOutput({ 'a-installer.exe': '1', 'b-installer.exe': '2' });
  assert.throws(() => packageAsset({ platform: 'windows-x64', binDir: ambiguous, outDir: scratch('out') }), /installer/);
});

test('packaging writes a sha256sum-format checksum next to the asset', () => {
  const bin = stageWailsOutput({ 'narration-utils-shell-amd64-installer.exe': 'the installer' });
  const out = scratch('out');

  const asset = packageAsset({ platform: 'windows-x64', binDir: bin, outDir: out });

  const line = readFileSync(join(out, 'narration-utils-windows-x64.exe.sha256'), 'utf8');
  assert.equal(line, `${sha256File(asset)}  narration-utils-windows-x64.exe\n`);
});

test('linux packaging tars the shell binary', { skip: !hasTool('tar') }, () => {
  const bin = stageWailsOutput({ 'narration-utils-shell': 'elf' });
  const out = scratch('out');

  const asset = packageAsset({ platform: 'linux-x64', binDir: bin, outDir: out });

  // Relative name: GNU tar reads a Windows drive letter in the archive argument as a remote host.
  const listing = spawnSync('tar', ['-tzf', basename(asset)], { cwd: out, encoding: 'utf8' });
  assert.equal(listing.stdout.trim(), 'narration-utils-shell');
});

test('linux packaging fails when the binary is missing', () => {
  assert.throws(() => packageAsset({ platform: 'linux-x64', binDir: scratch('bin'), outDir: scratch('out') }), /narration-utils-shell/);
});

test('macos packaging fails when the app bundle is missing', () => {
  assert.throws(() => packageAsset({ platform: 'macos-arm64', binDir: scratch('bin'), outDir: scratch('out') }), /Narration Utils\.app/);
});

test('macos packaging zips the app bundle', { skip: !hasTool('zip') || !hasTool('unzip') }, () => {
  const bin = stageWailsOutput({ 'Narration Utils.app/Contents/MacOS/narration-utils-shell': 'mach-o' });
  const out = scratch('out');

  const asset = packageAsset({ platform: 'macos-arm64', binDir: bin, outDir: out });

  const listing = spawnSync('unzip', ['-Z1', asset], { encoding: 'utf8' });
  assert.match(listing.stdout, /Narration Utils\.app\/Contents\/MacOS\/narration-utils-shell/);
});

function stageRelease(platforms) {
  const dir = scratch('release');
  for (const platform of platforms) {
    const asset = join(dir, assetName(platform));
    writeFileSync(asset, `bytes of ${platform}`);
    writeFileSync(join(dir, checksumName(platform)), `${sha256File(asset)}  ${assetName(platform)}\n`);
  }
  return dir;
}

test('only Windows is required; macOS and Linux are optional', () => {
  assert.deepEqual(
    Object.entries(PLATFORMS).map(([platform, { required }]) => [platform, required]),
    [
      ['windows-x64', true],
      ['macos-arm64', false],
      ['linux-x64', false],
    ],
  );
});

test('verifyAssets accepts a Windows-only release', () => {
  assert.deepEqual(verifyAssets(stageRelease(['windows-x64'])), []);
});

test('verifyAssets accepts a release with every platform whose checksums match', () => {
  assert.deepEqual(verifyAssets(stageRelease(Object.keys(PLATFORMS))), []);
});

test('verifyAssets reports a missing Windows asset and checksum', () => {
  assert.deepEqual(verifyAssets(stageRelease(['linux-x64'])), [
    'Missing narration-utils-windows-x64.exe',
    'Missing narration-utils-windows-x64.exe.sha256',
  ]);
});

test('verifyAssets reports an empty checksum file', () => {
  const dir = stageRelease(['windows-x64', 'macos-arm64']);
  writeFileSync(join(dir, checksumName('macos-arm64')), '');

  const problems = verifyAssets(dir);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /narration-utils-macos-arm64\.zip\.sha256/);
});

test('verifyAssets reports an asset that no longer matches its checksum', () => {
  const dir = stageRelease(['windows-x64']);
  writeFileSync(join(dir, assetName('windows-x64')), 'tampered');

  const problems = verifyAssets(dir);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /narration-utils-windows-x64\.exe.*checksum/);
});

test('verifyAssets reports an optional asset that is only half uploaded', () => {
  const dir = stageRelease(['windows-x64', 'linux-x64']);
  rmSync(join(dir, checksumName('linux-x64')));

  assert.deepEqual(verifyAssets(dir), ['Incomplete upload: narration-utils-linux-x64.tar.gz has no narration-utils-linux-x64.tar.gz.sha256']);
});

test('verifyAssets reports an optional checksum whose asset is missing', () => {
  const dir = stageRelease(['windows-x64', 'macos-arm64']);
  rmSync(join(dir, assetName('macos-arm64')));

  assert.deepEqual(verifyAssets(dir), ['Incomplete upload: narration-utils-macos-arm64.zip.sha256 has no narration-utils-macos-arm64.zip']);
});
