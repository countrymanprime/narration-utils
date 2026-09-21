import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PLATFORMS, assetName, attestationArgs, checksumName, packageAsset, sha256File, verifyAssets, verifyAttestations } from './assets.mjs';

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
  assert.equal(assetName('windows-x64'), 'narration-utils-windows-x64.zip');
  assert.equal(assetName('macos-arm64'), 'narration-utils-macos-arm64.zip');
  assert.equal(assetName('linux-x64'), 'narration-utils-linux-x64.tar.gz');
  assert.equal(checksumName('linux-x64'), 'narration-utils-linux-x64.tar.gz.sha256');
  assert.deepEqual(Object.keys(PLATFORMS), ['windows-x64', 'macos-arm64', 'linux-x64']);
});

test('assetName rejects a platform the release does not ship', () => {
  assert.throws(() => assetName('freebsd-x64'), /Unknown platform/);
});

// The Windows runner has no NSIS, so Wails only warns and the raw executable is the real output.
// It is zipped (a 400 MB download otherwise) and keeps the name the REAPER launcher looks for.
test('windows packaging fails when the shell exe is missing', () => {
  assert.throws(() => packageAsset({ platform: 'windows-x64', binDir: scratch('bin'), outDir: scratch('out') }), /narration-utils-shell\.exe/);
});

test('windows packaging zips the shell exe under its own name', { skip: process.platform !== 'win32' }, () => {
  const bin = stageWailsOutput({ 'narration-utils-shell.exe': 'raw shell' });
  const out = scratch('out');

  const asset = packageAsset({ platform: 'windows-x64', binDir: bin, outDir: out });

  assert.equal(asset, join(out, 'narration-utils-windows-x64.zip'));
  // bsdtar (System32) lists zips; Git Bash's GNU tar, which may come first on PATH, cannot.
  const tar = join(process.env.SystemRoot, 'System32', 'tar.exe');
  const listing = spawnSync(tar, ['-tf', basename(asset)], { cwd: out, encoding: 'utf8' });
  assert.equal(listing.stdout.trim(), 'narration-utils-shell.exe');
});

test('packaging writes a sha256sum-format checksum next to the asset', { skip: !hasTool('tar') }, () => {
  const bin = stageWailsOutput({ 'narration-utils-shell': 'elf' });
  const out = scratch('out');

  const asset = packageAsset({ platform: 'linux-x64', binDir: bin, outDir: out });

  const line = readFileSync(join(out, 'narration-utils-linux-x64.tar.gz.sha256'), 'utf8');
  assert.equal(line, `${sha256File(asset)}  narration-utils-linux-x64.tar.gz\n`);
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
    'Missing narration-utils-windows-x64.zip',
    'Missing narration-utils-windows-x64.zip.sha256',
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
  assert.match(problems[0], /narration-utils-windows-x64\.zip.*checksum/);
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

// `assets.mjs verify --attestations` asks `gh attestation verify` who built each downloaded file. The tests use a
// fake `run` in place of `gh`; the flag names and the signer identities were checked against real attestations
// (docs/adr/0071).
const REPOSITORY = 'countrymanprime/narration-utils';

function fakeGh(failing = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    const failure = failing[args[2]];
    if (failure) throw Object.assign(new Error('Command failed: gh'), { stderr: failure });
    return '';
  };
  return { calls, run };
}

test('attestationArgs pins the repository, the signer workflow, the main branch and github-hosted runners', () => {
  assert.deepEqual(attestationArgs({ file: '/r/narration-utils-windows-x64.zip', repository: REPOSITORY, platform: 'windows-x64' }), [
    'attestation',
    'verify',
    '/r/narration-utils-windows-x64.zip',
    '--repo',
    REPOSITORY,
    '--signer-workflow',
    `${REPOSITORY}/.github/workflows/prerelease.yml`,
    '--source-ref',
    'refs/heads/main',
    '--deny-self-hosted-runners',
  ]);
});

test('macOS and Linux are signed by the reusable attach workflow, not by the workflow that calls it', () => {
  for (const platform of ['macos-arm64', 'linux-x64']) {
    const args = attestationArgs({ file: 'x', repository: REPOSITORY, platform });
    assert.equal(args[args.indexOf('--signer-workflow') + 1], `${REPOSITORY}/.github/workflows/_attach-platform.yml`);
  }
});

test('verifyAttestations checks the archive and the checksum of every platform that is present', () => {
  const dir = stageRelease(['windows-x64', 'linux-x64']);
  const { calls, run } = fakeGh();

  assert.deepEqual(verifyAttestations(dir, { repository: REPOSITORY, run }), []);

  assert.deepEqual(
    calls.map((args) => basename(args[2])),
    [
      'narration-utils-windows-x64.zip',
      'narration-utils-windows-x64.zip.sha256',
      'narration-utils-linux-x64.tar.gz',
      'narration-utils-linux-x64.tar.gz.sha256',
    ],
  );
});

test('verifyAttestations does not ask about a platform that was never shipped', () => {
  const { calls, run } = fakeGh();

  verifyAttestations(stageRelease(['windows-x64']), { repository: REPOSITORY, run });

  assert.equal(calls.length, 2);
});

test('verifyAttestations names every file that has no valid attestation and why', () => {
  const dir = stageRelease(['windows-x64']);
  const { run } = fakeGh({ [join(dir, 'narration-utils-windows-x64.zip')]: 'Error: verifying with issuer "sigstore.dev"\n' });

  const problems = verifyAttestations(dir, { repository: REPOSITORY, run });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /narration-utils-windows-x64\.zip has no attestation from \.github\/workflows\/prerelease\.yml on refs\/heads\/main/);
  assert.match(problems[0], /verifying with issuer/);
});

test('verifyAttestations keeps going after a failure so every problem is reported at once', () => {
  const dir = stageRelease(['windows-x64']);
  const { calls, run } = fakeGh({
    [join(dir, 'narration-utils-windows-x64.zip')]: 'no attestation found',
    [join(dir, 'narration-utils-windows-x64.zip.sha256')]: 'no attestation found',
  });

  assert.equal(verifyAttestations(dir, { repository: REPOSITORY, run }).length, 2);
  assert.equal(calls.length, 2);
});

test('verifyAttestations reports a missing gh instead of passing', () => {
  const dir = stageRelease(['windows-x64']);
  const run = () => {
    throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
  };

  const problems = verifyAttestations(dir, { repository: REPOSITORY, run });

  assert.equal(problems.length, 2);
  assert.match(problems[0], /ENOENT/);
});

test('verifyAttestations needs a repository to verify against', () => {
  assert.throws(() => verifyAttestations(stageRelease(['windows-x64']), { repository: '', run: fakeGh().run }), /repository/i);
});

test('the verify command stays offline unless --attestations is passed, and then needs GITHUB_REPOSITORY', () => {
  const script = fileURLToPath(new URL('./assets.mjs', import.meta.url));
  const dir = stageRelease(['windows-x64']);
  const env = { ...process.env };
  delete env.GITHUB_REPOSITORY;

  const offline = spawnSync(process.execPath, [script, 'verify', dir], { encoding: 'utf8', env });
  assert.equal(offline.status, 0, offline.stderr);

  const online = spawnSync(process.execPath, [script, 'verify', dir, '--attestations'], { encoding: 'utf8', env });
  assert.equal(online.status, 2);
  assert.match(online.stderr, /GITHUB_REPOSITORY/);
});

test('verifyAssets rejects a file that is not one of the release assets or their checksums', () => {
  const dir = stageRelease(['windows-x64']);
  writeFileSync(join(dir, 'Setup.exe'), 'not built by the release workflow');
  writeFileSync(join(dir, `${assetName('windows-x64')}.bak`), 'a stray copy');

  assert.deepEqual(verifyAssets(dir), [
    'Unexpected file Setup.exe: promote publishes every file, and only the release assets are built and attested by the workflows',
    'Unexpected file narration-utils-windows-x64.zip.bak: promote publishes every file, and only the release assets are built and attested by the workflows',
  ]);
});

test('verifyAttestations keeps the end of a long gh error, where the reason is', () => {
  const dir = stageRelease(['windows-x64']);
  const noisy = `${'Loaded digest sha256:abc\n'.repeat(40)}Error: the signer workflow does not match`;
  const { run } = fakeGh({ [join(dir, 'narration-utils-windows-x64.zip')]: noisy });

  assert.match(verifyAttestations(dir, { repository: REPOSITORY, run })[0], /the signer workflow does not match/);
});

test('verifyAttestations passes each platform its own signer and the repository it was given', () => {
  const dir = stageRelease(['macos-arm64']);
  const { calls, run } = fakeGh();

  verifyAttestations(dir, { repository: 'someone/else', run });

  assert.deepEqual(calls[0], attestationArgs({ file: join(dir, 'narration-utils-macos-arm64.zip'), repository: 'someone/else', platform: 'macos-arm64' }));
  assert.ok(calls[0].includes('someone/else/.github/workflows/_attach-platform.yml'));
});

test('the verify command rejects a flag it does not know instead of skipping the check', () => {
  const dir = stageRelease(['windows-x64']);

  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./assets.mjs', import.meta.url)), 'verify', dir, '--attestation'], { encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown flag --attestation/);
});
