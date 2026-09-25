#!/usr/bin/env node

// Names, packages and verifies what each platform releases:
// narration-utils-<version>-<platform>.<ext> plus a .sha256 beside it, and on Windows also the setup program
// narration-utils-<version>-windows-x64-setup.exe and the notices narration-utils-<version>-THIRD-PARTY-NOTICES.txt, each with its own
// .sha256 (docs/adr/0082, docs/adr/0197). The version is in every name so that downloads of different releases can be told apart at a
// glance. The archive is what the in-app updater downloads (apps/desktop/internal/update/manifest.go builds the same name); the setup
// program is for a first install.
// Every platform builds and uploads its own asset at a different time, so checksums are per
// asset rather than one SHA256SUMS.txt that would need every platform to have finished.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_BINARY = 'narration-utils';
const MAC_APP_BUNDLE = 'Narration Utils.app';

// The setup program NSIS builds (apps/desktop/build/windows/installer/project.nsi names its OutFile the same, and a test keeps the
// two equal). This is its name in the build folder, which carries no version; packaging gives it the released name (installerName).
export const WINDOWS_INSTALLER = 'narration-utils-windows-x64-setup.exe';

// The third-party licences and the source offer of the release, under the name scripts/licenses/notices.py writes into the build folder
// (docs/operations/ci-and-releases.md, "Third-party notices"); packaging gives it the released name (noticesName). It is its own asset, not a second file in the update zip: the in-app updater refuses a zip that holds
// anything but narration-utils.exe (docs/adr/0074), and a client that predates a two-file zip would refuse every update to it.
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt';

// The workflows that build and attest an asset (docs/adr/0071). Windows is built and attested by the release job of
// prerelease.yml; the others by the reusable _attach-platform.yml, which is the signer named in the certificate even
// though build-macos.yml or build-linux.yml calls it. Releases are built from main only.
const PRERELEASE_WORKFLOW = '.github/workflows/prerelease.yml';
const ATTACH_WORKFLOW = '.github/workflows/_attach-platform.yml';
const SOURCE_REF = 'refs/heads/main';

function requireInBin(binDir, name) {
  if (!existsSync(join(binDir, name))) throw new Error(`Expected ${name} in ${binDir}; did the Wails build run?`);
}

// The notices are written after the Wails build (they read the frozen sidecars and the build's Go modules), into the same folder.
function requireNotices(binDir, name = NOTICES_FILE) {
  if (!existsSync(join(binDir, name))) {
    throw new Error(`Expected ${name} in ${binDir}. Write it with scripts/licenses/notices.py --out ${join(binDir, name)} after the build and before packaging.`);
  }
}

// The setup program is a second output of the Windows build (scripts/release/wails-build.mjs --installer); a build without it must not ship.
export function requireInstaller(binDir, name = WINDOWS_INSTALLER) {
  if (!existsSync(join(binDir, name))) {
    throw new Error(`Expected the setup program ${name} in ${binDir}. scripts/release/wails-build.mjs builds it with makensis when it is run with --installer on Windows.`);
  }
}

// `archive` turns Wails' output in binDir into the asset at `target` (an absolute path in `outDir`).
// `required` platforms must be on a release before it can be promoted; the others ship when their
// (separate, re-runnable) build succeeds and are simply absent when it did not. `installer` is a second file of the platform, copied
// from the Wails output as it is: it is as required as the archive, so a build that lost it cannot be promoted.
export const PLATFORMS = {
  // The self-contained exe is zipped (about 400 MB otherwise) and keeps the name the REAPER launcher looks for (narration-utils.exe);
  // that zip is what the in-app updater downloads. The setup program is what a narrator runs first.
  'windows-x64': {
    extension: '.zip',
    installer: WINDOWS_INSTALLER,
    notices: NOTICES_FILE,
    required: true,
    signerWorkflow: PRERELEASE_WORKFLOW,
    archive({ binDir, outDir, target }) {
      requireInBin(binDir, `${APP_BINARY}.exe`);
      // Windows' bsdtar writes zips (-a picks the format from the name). Git Bash's GNU tar comes
      // first on PATH there and cannot, so call the system one by path.
      const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
      execFileSync(tar, ['-a', '-cf', basename(target), '-C', binDir, `${APP_BINARY}.exe`], { cwd: outDir, stdio: 'inherit' });
    },
  },
  // A .app is a directory, so it has to be archived. -y keeps symlinks inside the bundle.
  'macos-arm64': {
    extension: '.zip',
    required: false,
    signerWorkflow: ATTACH_WORKFLOW,
    archive({ binDir, target }) {
      requireInBin(binDir, MAC_APP_BUNDLE);
      execFileSync('zip', ['-r', '-y', target, MAC_APP_BUNDLE], { cwd: binDir, stdio: 'inherit' });
    },
  },
  // tar keeps the executable bit, which a bare release download would lose.
  'linux-x64': {
    extension: '.tar.gz',
    required: false,
    signerWorkflow: ATTACH_WORKFLOW,
    archive({ binDir, outDir, target }) {
      requireInBin(binDir, APP_BINARY);
      // A relative archive name plus -C keeps a Windows drive letter out of tar's archive argument.
      execFileSync('tar', ['-czf', basename(target), '-C', binDir, APP_BINARY], { cwd: outDir, stdio: 'inherit' });
    },
  },
};

function platformEntry(platform) {
  if (!Object.hasOwn(PLATFORMS, platform)) {
    throw new Error(`Unknown platform "${platform}". Expected one of: ${Object.keys(PLATFORMS).join(', ')}.`);
  }
  return PLATFORMS[platform];
}

// The version in every released name is bare MAJOR.MINOR.PATCH, each part one to six digits with no leading zero: the rule the app's
// updater reads a version by (apps/desktop/internal/update/version.go). A candidate and its promotion are the same bytes, so v0.2.7-rc
// and v0.2.7 publish the same names.
const RELEASE_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

function requireVersion(version) {
  if (typeof version !== 'string' || !RELEASE_VERSION.test(version)) {
    throw new Error(`"${version}" is not a release version. Expected bare MAJOR.MINOR.PATCH, for example 0.2.7 (no v, no -rc).`);
  }
  return version;
}

const released = (version, name) => `narration-utils-${requireVersion(version)}-${name}`;

export const assetName = (platform, version) => released(version, `${platform}${platformEntry(platform).extension}`);
export const checksumName = (platform, version) => `${assetName(platform, version)}.sha256`;
export const installerName = (platform, version) => (platformEntry(platform).installer ? released(version, `${platform}-setup.exe`) : undefined);
export const noticesName = (platform, version) => (platformEntry(platform).notices ? released(version, platformEntry(platform).notices) : undefined);
export const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// Every downloadable of a platform: the archive and, when there is one, the setup program and the notices. Each has a .sha256 beside it.
const platformAssets = (platform, version) =>
  [assetName(platform, version), installerName(platform, version), noticesName(platform, version)].filter(Boolean);

// Every file a platform puts on the release of this version, each asset followed by its checksum.
export const releaseFiles = (platform, version) => platformAssets(platform, version).flatMap((name) => [name, `${name}.sha256`]);

const writeChecksum = (out, name) => writeFileSync(join(out, `${name}.sha256`), `${sha256File(join(out, name))}  ${name}\n`);

export function packageAsset({ platform, binDir, outDir, version }) {
  const { archive, installer, notices } = platformEntry(platform);
  const bin = resolve(binDir);
  const out = resolve(outDir);
  const target = join(out, assetName(platform, version));
  // Before anything is written or zipped: a build without its setup program is not a release.
  if (installer) requireInstaller(bin, installer);
  if (notices) requireNotices(bin, notices);
  mkdirSync(out, { recursive: true });
  rmSync(target, { force: true });
  archive({ binDir: bin, outDir: out, target });
  writeChecksum(out, assetName(platform, version));
  if (installer) {
    copyFileSync(join(bin, installer), join(out, installerName(platform, version)));
    writeChecksum(out, installerName(platform, version));
  }
  if (notices) {
    copyFileSync(join(bin, notices), join(out, noticesName(platform, version)));
    writeChecksum(out, noticesName(platform, version));
  }
  return target;
}

// Returns human-readable problems; an empty array means the release of this version is safe to promote: every
// required platform is present and intact, and any optional platform that is present is intact.
export function verifyAssets(dir, version) {
  requireVersion(version);
  const problems = [];
  for (const [platform, { required }] of Object.entries(PLATFORMS)) {
    const files = releaseFiles(platform, version);
    const present = files.filter((file) => existsSync(join(dir, file)));
    if (present.length === 0 && !required) continue;
    const absent = files.filter((file) => !present.includes(file));
    if (absent.length && required) {
      problems.push(...absent.map((file) => `Missing ${file}`));
      continue;
    }
    if (absent.length) {
      // An optional upload was interrupted between an asset and its checksum.
      problems.push(`Incomplete upload: ${present[0]} has no ${absent[0]}`);
      continue;
    }
    for (const name of platformAssets(platform, version)) {
      const sumName = `${name}.sha256`;
      const expected = readFileSync(join(dir, sumName), 'utf8').trim().split(/\s+/)[0];
      if (!/^[0-9a-f]{64}$/.test(expected)) problems.push(`${sumName} does not contain a SHA-256 checksum`);
      else if (sha256File(join(dir, name)) !== expected) problems.push(`${name} does not match its checksum in ${sumName}`);
    }
  }
  // Promote publishes every file in the directory, so a file that is not a release asset must stop it: nothing built or
  // attested it. A file named for another version is one of those too.
  const known = new Set(Object.keys(PLATFORMS).flatMap((platform) => releaseFiles(platform, version)));
  for (const name of readdirSync(dir).sort()) {
    if (!known.has(name)) {
      problems.push(`Unexpected file ${name}: promote publishes every file, and only the release assets are built and attested by the workflows`);
    }
  }
  return problems;
}

// The `gh attestation verify` arguments that say who may have built a file. `--repo` alone would accept an attestation
// from any workflow of the repository, a pull request's included, so the signer workflow and the branch are named too.
export function attestationArgs({ file, repository, platform }) {
  return [
    'attestation',
    'verify',
    file,
    '--repo',
    repository,
    '--signer-workflow',
    `${repository}/${platformEntry(platform).signerWorkflow}`,
    '--source-ref',
    SOURCE_REF,
    '--deny-self-hosted-runners',
  ];
}

const runGh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Returns a problem for every present asset or checksum that has no attestation from the workflow that should have built
// it. Meant for promote, which has the network and the GitHub CLI; `verifyAssets` stays offline.
export function verifyAttestations(dir, { repository, version, run = runGh } = {}) {
  if (!repository) throw new Error('Verifying attestations needs the repository, for example countrymanprime/narration-utils.');
  requireVersion(version);
  const problems = [];
  for (const [platform, { signerWorkflow }] of Object.entries(PLATFORMS)) {
    for (const name of releaseFiles(platform, version)) {
      const file = join(dir, name);
      if (!existsSync(file)) continue;
      try {
        run(attestationArgs({ file, repository, platform }));
      } catch (error) {
        const reason = String(error.stderr || error.message).trim().slice(-300);
        problems.push(`${name} has no attestation from ${signerWorkflow} on ${SOURCE_REF}: ${reason}`);
      }
    }
  }
  return problems;
}

function exitWith(problems) {
  console.error(problems.map((problem) => `- ${problem}`).join('\n'));
  process.exit(1);
}

const USAGE = 'Usage: assets.mjs package <platform> [<version>] | assets.mjs verify <dir> <version> [--attestations]';

function verifyCommand(dir, version, flags) {
  const unknown = flags.find((flag) => flag !== '--attestations');
  if (unknown) {
    console.error(`Unknown flag ${unknown}. ${USAGE}`);
    process.exit(2);
  }
  const problems = verifyAssets(dir, version);
  if (problems.length) exitWith(problems);
  const shipped = Object.keys(PLATFORMS).filter((platform) => existsSync(join(dir, assetName(platform, version))));
  console.log(`Verified ${shipped.join(', ')} of ${version} in ${dir}.`);
  if (!flags.includes('--attestations')) return;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    console.error('--attestations needs GITHUB_REPOSITORY (owner/repo) and an authenticated GitHub CLI.');
    process.exit(2);
  }
  const attestationProblems = verifyAttestations(dir, { repository, version });
  if (attestationProblems.length) exitWith(attestationProblems);
  console.log(`Every asset and checksum is attested by the release workflows of ${repository}.`);
}

// The version packaging names the files with, when none is given: the root package.json's, which the build stamped into the program
// (build-native applies the computed release version to it before building).
const checkedInVersion = () => JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

function main([command, argument, ...rest]) {
  if (command === 'package' && argument && rest.length <= 1) {
    const asset = packageAsset({
      platform: argument,
      binDir: process.env.WAILS_BIN_DIR ?? 'apps/desktop/build/bin',
      outDir: process.env.RELEASE_ASSETS_DIR ?? 'release-assets',
      version: rest[0] ?? checkedInVersion(),
    });
    console.log(`Packaged ${asset}`);
  } else if (command === 'verify' && argument && rest[0] && !rest[0].startsWith('--')) {
    const [version, ...flags] = rest;
    try {
      requireVersion(version);
    } catch (error) {
      console.error(`${error.message} ${USAGE}`);
      process.exit(2);
    }
    verifyCommand(argument, version, flags);
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
