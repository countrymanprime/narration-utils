import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  NOTICES_FILE,
  PLATFORMS,
  WINDOWS_INSTALLER,
  assetName,
  attestationArgs,
  checksumName,
  installerName,
  noticesName,
  packageAsset,
  releaseFiles,
  sha256File,
  verifyAssets,
  verifyAttestations,
} from './assets.mjs';

// The version every test names its release with.
const V = '0.2.7';

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

test('every platform asset is narration-utils-<version>-<platform>.<ext>', () => {
  assert.equal(assetName('windows-x64', V), 'narration-utils-0.2.7-windows-x64.zip');
  assert.equal(assetName('macos-arm64', V), 'narration-utils-0.2.7-macos-arm64.zip');
  assert.equal(assetName('linux-x64', V), 'narration-utils-0.2.7-linux-x64.tar.gz');
  assert.equal(checksumName('linux-x64', V), 'narration-utils-0.2.7-linux-x64.tar.gz.sha256');
  assert.deepEqual(Object.keys(PLATFORMS), ['windows-x64', 'macos-arm64', 'linux-x64']);
});

test('assetName rejects a platform the release does not ship', () => {
  assert.throws(() => assetName('freebsd-x64', V), /Unknown platform/);
});

// Windows ships two files (docs/adr/0082): the zip the in-app updater downloads (a 400 MB download otherwise, and it keeps the
// name the REAPER launcher looks for) and the setup program a narrator runs the first time, which Wails builds with NSIS.
test('windows ships a zip for the updater and a setup program for a first install, both named for the version', () => {
  assert.equal(WINDOWS_INSTALLER, 'narration-utils-windows-x64-setup.exe');
  assert.equal(installerName('windows-x64', V), 'narration-utils-0.2.7-windows-x64-setup.exe');
  assert.equal(installerName('macos-arm64', V), undefined);
  assert.equal(installerName('linux-x64', V), undefined);
  assert.deepEqual(releaseFiles('windows-x64', V), [
    'narration-utils-0.2.7-windows-x64.zip',
    'narration-utils-0.2.7-windows-x64.zip.sha256',
    'narration-utils-0.2.7-windows-x64-setup.exe',
    'narration-utils-0.2.7-windows-x64-setup.exe.sha256',
    'narration-utils-0.2.7-THIRD-PARTY-NOTICES.txt',
    'narration-utils-0.2.7-THIRD-PARTY-NOTICES.txt.sha256',
  ]);
  assert.deepEqual(releaseFiles('linux-x64', V), ['narration-utils-0.2.7-linux-x64.tar.gz', 'narration-utils-0.2.7-linux-x64.tar.gz.sha256']);
});

test('the third-party notices are a Windows release asset of their own, never a second file in the update zip', () => {
  assert.equal(NOTICES_FILE, 'THIRD-PARTY-NOTICES.txt');
  assert.equal(noticesName('windows-x64', V), 'narration-utils-0.2.7-THIRD-PARTY-NOTICES.txt');
  assert.equal(noticesName('macos-arm64', V), undefined);
  assert.equal(noticesName('linux-x64', V), undefined);
});

test('the updater still finds its zip: the setup program does not change what assetName returns', () => {
  assert.equal(assetName('windows-x64', V), 'narration-utils-0.2.7-windows-x64.zip');
});

test('windows packaging fails when the exe is missing', () => {
  const bin = stageWailsOutput({ [WINDOWS_INSTALLER]: 'setup bytes', [NOTICES_FILE]: 'notices' });

  assert.throws(() => packageAsset({ platform: 'windows-x64', binDir: bin, outDir: scratch('out'), version: V }), /narration-utils\.exe/);
});

// `wails build -nsis` only warns when makensis is missing, so the setup program can be absent from a build that otherwise
// succeeded. Packaging must refuse that, and must do so before it spends time zipping 400 MB.
test('windows packaging fails, naming the setup program and makensis, when only the exe was built', () => {
  const bin = stageWailsOutput({ 'narration-utils.exe': 'raw exe' });
  const out = scratch('out');

  assert.throws(() => packageAsset({ platform: 'windows-x64', binDir: bin, outDir: out, version: V }), /narration-utils-windows-x64-setup\.exe.*makensis/s);
  assert.deepEqual(readdirSync(out), []);
});

// A build that could not write the notices (the generator refuses to guess a licence) must never become a release, and packaging must say
// so before it zips 400 MB.
test('windows packaging fails, naming the generator, when the notices were not written', () => {
  const bin = stageWailsOutput({ 'narration-utils.exe': 'raw exe', [WINDOWS_INSTALLER]: 'setup bytes' });
  const out = scratch('out');

  assert.throws(() => packageAsset({ platform: 'windows-x64', binDir: bin, outDir: out, version: V }), /THIRD-PARTY-NOTICES\.txt.*scripts\/licenses\/notices\.py/s);
  assert.deepEqual(readdirSync(out), []);
});

test('windows packaging copies the notices beside the zip and the setup program and checksums them', { skip: process.platform !== 'win32' }, () => {
  const bin = stageWailsOutput({ 'narration-utils.exe': 'raw exe', [WINDOWS_INSTALLER]: 'setup bytes', [NOTICES_FILE]: 'the notices' });
  const out = scratch('out');

  packageAsset({ platform: 'windows-x64', binDir: bin, outDir: out, version: V });

  const notices = noticesName('windows-x64', V);
  assert.equal(readFileSync(join(out, notices), 'utf8'), 'the notices');
  assert.equal(readFileSync(join(out, `${notices}.sha256`), 'utf8'), `${sha256File(join(out, notices))}  ${notices}\n`);
});

test('windows packaging copies the setup program under its release name and checksums it', { skip: process.platform !== 'win32' }, () => {
  const bin = stageWailsOutput({ 'narration-utils.exe': 'raw exe', [WINDOWS_INSTALLER]: 'setup bytes', [NOTICES_FILE]: 'the notices' });
  const out = scratch('out');

  packageAsset({ platform: 'windows-x64', binDir: bin, outDir: out, version: V });

  const setup = installerName('windows-x64', V);
  assert.equal(readFileSync(join(out, setup), 'utf8'), 'setup bytes');
  assert.equal(readFileSync(join(out, `${setup}.sha256`), 'utf8'), `${sha256File(join(out, setup))}  ${setup}\n`);
  assert.deepEqual(readdirSync(out).sort(), releaseFiles('windows-x64', V).sort());
});

test('windows packaging zips the exe under its own name', { skip: process.platform !== 'win32' }, () => {
  const bin = stageWailsOutput({ 'narration-utils.exe': 'raw exe', [WINDOWS_INSTALLER]: 'setup bytes', [NOTICES_FILE]: 'the notices' });
  const out = scratch('out');

  const asset = packageAsset({ platform: 'windows-x64', binDir: bin, outDir: out, version: V });

  assert.equal(asset, join(out, 'narration-utils-0.2.7-windows-x64.zip'));
  // bsdtar (System32) lists zips; Git Bash's GNU tar, which may come first on PATH, cannot.
  const tar = join(process.env.SystemRoot, 'System32', 'tar.exe');
  const listing = spawnSync(tar, ['-tf', basename(asset)], { cwd: out, encoding: 'utf8' });
  // One file, on purpose: the in-app updater refuses a zip that holds anything else (docs/adr/0074), and the notices are a separate asset.
  assert.equal(listing.stdout.trim(), 'narration-utils.exe');
});

test('packaging writes a sha256sum-format checksum next to the asset', { skip: !hasTool('tar') }, () => {
  const bin = stageWailsOutput({ 'narration-utils': 'elf' });
  const out = scratch('out');

  const asset = packageAsset({ platform: 'linux-x64', binDir: bin, outDir: out, version: V });

  const line = readFileSync(join(out, 'narration-utils-0.2.7-linux-x64.tar.gz.sha256'), 'utf8');
  assert.equal(line, `${sha256File(asset)}  narration-utils-0.2.7-linux-x64.tar.gz\n`);
});

test('linux packaging tars the binary', { skip: !hasTool('tar') }, () => {
  const bin = stageWailsOutput({ 'narration-utils': 'elf' });
  const out = scratch('out');

  const asset = packageAsset({ platform: 'linux-x64', binDir: bin, outDir: out, version: V });

  // Relative name: GNU tar reads a Windows drive letter in the archive argument as a remote host.
  const listing = spawnSync('tar', ['-tzf', basename(asset)], { cwd: out, encoding: 'utf8' });
  assert.equal(listing.stdout.trim(), 'narration-utils');
});

test('linux packaging fails when the binary is missing', () => {
  assert.throws(() => packageAsset({ platform: 'linux-x64', binDir: scratch('bin'), outDir: scratch('out'), version: V }), /narration-utils/);
});

test('macos packaging fails when the app bundle is missing', () => {
  assert.throws(() => packageAsset({ platform: 'macos-arm64', binDir: scratch('bin'), outDir: scratch('out'), version: V }), /Narration Utils\.app/);
});

test('macos packaging zips the app bundle', { skip: !hasTool('zip') || !hasTool('unzip') }, () => {
  const bin = stageWailsOutput({ 'Narration Utils.app/Contents/MacOS/narration-utils': 'mach-o' });
  const out = scratch('out');

  const asset = packageAsset({ platform: 'macos-arm64', binDir: bin, outDir: out, version: V });

  const listing = spawnSync('unzip', ['-Z1', asset], { encoding: 'utf8' });
  assert.match(listing.stdout, /Narration Utils\.app\/Contents\/MacOS\/narration-utils/);
});

function stageRelease(platforms) {
  const dir = scratch('release');
  for (const platform of platforms) {
    for (const name of [assetName(platform, V), installerName(platform, V), noticesName(platform, V)].filter(Boolean)) {
      const asset = join(dir, name);
      writeFileSync(asset, `bytes of ${name}`);
      writeFileSync(join(dir, `${name}.sha256`), `${sha256File(asset)}  ${name}\n`);
    }
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
  assert.deepEqual(verifyAssets(stageRelease(['windows-x64']), V), []);
});

test('verifyAssets accepts a release with every platform whose checksums match', () => {
  assert.deepEqual(verifyAssets(stageRelease(Object.keys(PLATFORMS)), V), []);
});

test('verifyAssets reports a missing Windows asset and checksum', () => {
  assert.deepEqual(verifyAssets(stageRelease(['linux-x64']), V), [
    'Missing narration-utils-0.2.7-windows-x64.zip',
    'Missing narration-utils-0.2.7-windows-x64.zip.sha256',
    'Missing narration-utils-0.2.7-windows-x64-setup.exe',
    'Missing narration-utils-0.2.7-windows-x64-setup.exe.sha256',
    'Missing narration-utils-0.2.7-THIRD-PARTY-NOTICES.txt',
    'Missing narration-utils-0.2.7-THIRD-PARTY-NOTICES.txt.sha256',
  ]);
});

// The licences and the source offer are part of the release: a build without them, or with a file that was changed after it was checksummed,
// must not be promoted.
test('verifyAssets reports a Windows release that has no third-party notices', () => {
  const dir = stageRelease(['windows-x64']);
  rmSync(join(dir, noticesName('windows-x64', V)));
  rmSync(join(dir, `${noticesName('windows-x64', V)}.sha256`));

  assert.deepEqual(verifyAssets(dir, V), ['Missing narration-utils-0.2.7-THIRD-PARTY-NOTICES.txt', 'Missing narration-utils-0.2.7-THIRD-PARTY-NOTICES.txt.sha256']);
});

test('verifyAssets reports notices that no longer match their checksum', () => {
  const dir = stageRelease(['windows-x64']);
  writeFileSync(join(dir, noticesName('windows-x64', V)), 'tampered');

  const problems = verifyAssets(dir, V);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /narration-utils-0\.2\.7-THIRD-PARTY-NOTICES\.txt.*checksum/);
});

test('verifyAttestations checks the notices like every other file of the release', () => {
  const dir = stageRelease(['windows-x64']);
  const asked = [];

  verifyAttestations(dir, { repository: 'o/r', version: V, run: (args) => asked.push(args[2]) });

  assert.ok(asked.includes(join(dir, noticesName('windows-x64', V))), 'the notices file was verified');
  assert.ok(asked.includes(join(dir, `${noticesName('windows-x64', V)}.sha256`)), 'and its checksum');
});

// A build that lost its installer (makensis missing, the Wails step skipped) must never become a release.
test('verifyAssets reports a Windows release that has the zip but no setup program', () => {
  const dir = stageRelease(['windows-x64']);
  rmSync(join(dir, installerName('windows-x64', V)));
  rmSync(join(dir, `${installerName('windows-x64', V)}.sha256`));

  assert.deepEqual(verifyAssets(dir, V), ['Missing narration-utils-0.2.7-windows-x64-setup.exe', 'Missing narration-utils-0.2.7-windows-x64-setup.exe.sha256']);
});

test('verifyAssets reports a setup program that no longer matches its checksum', () => {
  const dir = stageRelease(['windows-x64']);
  writeFileSync(join(dir, installerName('windows-x64', V)), 'tampered');

  const problems = verifyAssets(dir, V);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /narration-utils-0\.2\.7-windows-x64-setup\.exe.*checksum/);
});

test('verifyAssets reports a setup program whose checksum is missing', () => {
  const dir = stageRelease(['windows-x64']);
  rmSync(join(dir, `${installerName('windows-x64', V)}.sha256`));

  assert.deepEqual(verifyAssets(dir, V), ['Missing narration-utils-0.2.7-windows-x64-setup.exe.sha256']);
});

test('verifyAssets reports an empty checksum file', () => {
  const dir = stageRelease(['windows-x64', 'macos-arm64']);
  writeFileSync(join(dir, checksumName('macos-arm64', V)), '');

  const problems = verifyAssets(dir, V);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /narration-utils-0\.2\.7-macos-arm64\.zip\.sha256/);
});

test('verifyAssets reports an asset that no longer matches its checksum', () => {
  const dir = stageRelease(['windows-x64']);
  writeFileSync(join(dir, assetName('windows-x64', V)), 'tampered');

  const problems = verifyAssets(dir, V);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /narration-utils-0\.2\.7-windows-x64\.zip.*checksum/);
});

test('verifyAssets reports an optional asset that is only half uploaded', () => {
  const dir = stageRelease(['windows-x64', 'linux-x64']);
  rmSync(join(dir, checksumName('linux-x64', V)));

  assert.deepEqual(verifyAssets(dir, V), ['Incomplete upload: narration-utils-0.2.7-linux-x64.tar.gz has no narration-utils-0.2.7-linux-x64.tar.gz.sha256']);
});

test('verifyAssets reports an optional checksum whose asset is missing', () => {
  const dir = stageRelease(['windows-x64', 'macos-arm64']);
  rmSync(join(dir, assetName('macos-arm64', V)));

  assert.deepEqual(verifyAssets(dir, V), ['Incomplete upload: narration-utils-0.2.7-macos-arm64.zip.sha256 has no narration-utils-0.2.7-macos-arm64.zip']);
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
  assert.deepEqual(attestationArgs({ file: '/r/narration-utils-0.2.7-windows-x64.zip', repository: REPOSITORY, platform: 'windows-x64' }), [
    'attestation',
    'verify',
    '/r/narration-utils-0.2.7-windows-x64.zip',
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

test('verifyAttestations checks every file of every platform that is present, the setup program and the notices included', () => {
  const dir = stageRelease(['windows-x64', 'linux-x64']);
  const { calls, run } = fakeGh();

  assert.deepEqual(verifyAttestations(dir, { repository: REPOSITORY, version: V, run }), []);

  assert.deepEqual(
    calls.map((args) => basename(args[2])),
    [
      'narration-utils-0.2.7-windows-x64.zip',
      'narration-utils-0.2.7-windows-x64.zip.sha256',
      'narration-utils-0.2.7-windows-x64-setup.exe',
      'narration-utils-0.2.7-windows-x64-setup.exe.sha256',
      'narration-utils-0.2.7-THIRD-PARTY-NOTICES.txt',
      'narration-utils-0.2.7-THIRD-PARTY-NOTICES.txt.sha256',
      'narration-utils-0.2.7-linux-x64.tar.gz',
      'narration-utils-0.2.7-linux-x64.tar.gz.sha256',
    ],
  );
});

test('verifyAttestations does not ask about a platform that was never shipped', () => {
  const { calls, run } = fakeGh();

  verifyAttestations(stageRelease(['windows-x64']), { repository: REPOSITORY, version: V, run });

  assert.equal(calls.length, 6);
});

test('verifyAttestations names every file that has no valid attestation and why', () => {
  const dir = stageRelease(['windows-x64']);
  const { run } = fakeGh({ [join(dir, 'narration-utils-0.2.7-windows-x64.zip')]: 'Error: verifying with issuer "sigstore.dev"\n' });

  const problems = verifyAttestations(dir, { repository: REPOSITORY, version: V, run });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /narration-utils-0\.2\.7-windows-x64\.zip has no attestation from \.github\/workflows\/prerelease\.yml on refs\/heads\/main/);
  assert.match(problems[0], /verifying with issuer/);
});

test('verifyAttestations keeps going after a failure so every problem is reported at once', () => {
  const dir = stageRelease(['windows-x64']);
  const { calls, run } = fakeGh({
    [join(dir, 'narration-utils-0.2.7-windows-x64.zip')]: 'no attestation found',
    [join(dir, 'narration-utils-0.2.7-windows-x64.zip.sha256')]: 'no attestation found',
  });

  assert.equal(verifyAttestations(dir, { repository: REPOSITORY, version: V, run }).length, 2);
  assert.equal(calls.length, 6);
});

test('verifyAttestations reports a missing gh instead of passing', () => {
  const dir = stageRelease(['windows-x64']);
  const run = () => {
    throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
  };

  const problems = verifyAttestations(dir, { repository: REPOSITORY, version: V, run });

  assert.equal(problems.length, 6);
  assert.match(problems[0], /ENOENT/);
});

test('verifyAttestations needs a repository to verify against', () => {
  assert.throws(() => verifyAttestations(stageRelease(['windows-x64']), { repository: '', version: V, run: fakeGh().run }), /repository/i);
});

test('the verify command stays offline unless --attestations is passed, and then needs GITHUB_REPOSITORY', () => {
  const script = fileURLToPath(new URL('./assets.mjs', import.meta.url));
  const dir = stageRelease(['windows-x64']);
  const env = { ...process.env };
  delete env.GITHUB_REPOSITORY;

  const offline = spawnSync(process.execPath, [script, 'verify', dir, V], { encoding: 'utf8', env });
  assert.equal(offline.status, 0, offline.stderr);

  const online = spawnSync(process.execPath, [script, 'verify', dir, V, '--attestations'], { encoding: 'utf8', env });
  assert.equal(online.status, 2);
  assert.match(online.stderr, /GITHUB_REPOSITORY/);
});

test('verifyAssets rejects a file that is not one of the release assets or their checksums', () => {
  const dir = stageRelease(['windows-x64']);
  writeFileSync(join(dir, 'Setup.exe'), 'not built by the release workflow');
  writeFileSync(join(dir, 'Narration Utils-amd64-installer.exe'), 'the raw name Wails gives an installer, never a release asset');
  writeFileSync(join(dir, `${assetName('windows-x64', V)}.bak`), 'a stray copy');

  assert.deepEqual(verifyAssets(dir, V), [
    'Unexpected file Narration Utils-amd64-installer.exe: promote publishes every file, and only the release assets are built and attested by the workflows',
    'Unexpected file Setup.exe: promote publishes every file, and only the release assets are built and attested by the workflows',
    'Unexpected file narration-utils-0.2.7-windows-x64.zip.bak: promote publishes every file, and only the release assets are built and attested by the workflows',
  ]);
});

test('verifyAttestations keeps the end of a long gh error, where the reason is', () => {
  const dir = stageRelease(['windows-x64']);
  const noisy = `${'Loaded digest sha256:abc\n'.repeat(40)}Error: the signer workflow does not match`;
  const { run } = fakeGh({ [join(dir, 'narration-utils-0.2.7-windows-x64.zip')]: noisy });

  assert.match(verifyAttestations(dir, { repository: REPOSITORY, version: V, run })[0], /the signer workflow does not match/);
});

test('verifyAttestations passes each platform its own signer and the repository it was given', () => {
  const dir = stageRelease(['macos-arm64']);
  const { calls, run } = fakeGh();

  verifyAttestations(dir, { repository: 'someone/else', version: V, run });

  assert.deepEqual(calls[0], attestationArgs({ file: join(dir, 'narration-utils-0.2.7-macos-arm64.zip'), repository: 'someone/else', platform: 'macos-arm64' }));
  assert.ok(calls[0].includes('someone/else/.github/workflows/_attach-platform.yml'));
});

test('the verify command rejects a flag it does not know instead of skipping the check', () => {
  const dir = stageRelease(['windows-x64']);

  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./assets.mjs', import.meta.url)), 'verify', dir, V, '--attestation'], { encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown flag --attestation/);
});

// The version is what tells three downloads apart at a glance (docs/adr/0197); it is bare, so a candidate and its promotion publish the same
// names, and the rule is the one the app's updater reads a version by.
test('every released name carries the bare version, and a version that is not one is refused', () => {
  for (const platform of Object.keys(PLATFORMS)) {
    for (const name of releaseFiles(platform, '1.12.0')) assert.match(name, /^narration-utils-1\.12\.0-/);
  }
  for (const bad of ['v0.2.7', '0.2.7-rc', '0.2', '0.02.7', '1234567.0.0', '', undefined]) {
    assert.throws(() => assetName('windows-x64', bad), /not a release version/, String(bad));
  }
});

test('verifyAssets rejects the files of another version as unexpected, and misses its own', () => {
  const dir = scratch('release');
  for (const name of releaseFiles('windows-x64', '0.2.6')) writeFileSync(join(dir, name), 'older');

  const problems = verifyAssets(dir, V);

  assert.ok(problems.includes('Missing narration-utils-0.2.7-windows-x64.zip'), problems.join('\n'));
  assert.ok(problems.some((problem) => problem.startsWith('Unexpected file narration-utils-0.2.6-windows-x64.zip:')), problems.join('\n'));
});

test('the verify command needs the version the files are named for', () => {
  const script = fileURLToPath(new URL('./assets.mjs', import.meta.url));
  const dir = stageRelease(['windows-x64']);

  for (const args of [[dir], [dir, '--attestations'], [dir, 'v0.2.7']]) {
    const result = spawnSync(process.execPath, [script, 'verify', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, args.join(' '));
  }
  const wrong = spawnSync(process.execPath, [script, 'verify', dir, '0.2.8'], { encoding: 'utf8' });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /Missing narration-utils-0\.2\.8-windows-x64\.zip/);
});
