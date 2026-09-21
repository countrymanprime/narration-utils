#!/usr/bin/env node

// Names, packages and verifies the one downloadable per platform:
// narration-utils-<platform>.<ext> plus a narration-utils-<platform>.<ext>.sha256 beside it.
// Every platform builds and uploads its own asset at a different time, so checksums are per
// asset rather than one SHA256SUMS.txt that would need every platform to have finished.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_BINARY = 'narration-utils';
const MAC_APP_BUNDLE = 'Narration Utils.app';

// The workflows that build and attest an asset (docs/adr/0071). Windows is built and attested by the release job of
// prerelease.yml; the others by the reusable _attach-platform.yml, which is the signer named in the certificate even
// though build-macos.yml or build-linux.yml calls it. Releases are built from main only.
const PRERELEASE_WORKFLOW = '.github/workflows/prerelease.yml';
const ATTACH_WORKFLOW = '.github/workflows/_attach-platform.yml';
const SOURCE_REF = 'refs/heads/main';

function requireInBin(binDir, name) {
  if (!existsSync(join(binDir, name))) throw new Error(`Expected ${name} in ${binDir}; did the Wails build run?`);
}

// `archive` turns Wails' output in binDir into the asset at `target` (an absolute path in `outDir`).
// `required` platforms must be on a release before it can be promoted; the others ship when their
// (separate, re-runnable) build succeeds and are simply absent when it did not.
export const PLATFORMS = {
  // The runner has no NSIS, so `wails build -nsis` only warns and the raw self-contained exe is the
  // real output. It is zipped (about 400 MB otherwise) and keeps the name the REAPER launcher looks for (narration-utils.exe).
  'windows-x64': {
    extension: '.zip',
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

export const assetName = (platform) => `narration-utils-${platform}${platformEntry(platform).extension}`;
export const checksumName = (platform) => `${assetName(platform)}.sha256`;
export const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export function packageAsset({ platform, binDir, outDir }) {
  const { archive } = platformEntry(platform);
  const out = resolve(outDir);
  const target = join(out, assetName(platform));
  mkdirSync(out, { recursive: true });
  rmSync(target, { force: true });
  archive({ binDir: resolve(binDir), outDir: out, target });
  writeFileSync(join(out, checksumName(platform)), `${sha256File(target)}  ${assetName(platform)}\n`);
  return target;
}

// Returns human-readable problems; an empty array means the release is safe to promote: every
// required platform is present and intact, and any optional platform that is present is intact.
export function verifyAssets(dir) {
  const problems = [];
  for (const [platform, { required }] of Object.entries(PLATFORMS)) {
    const name = assetName(platform);
    const sumName = checksumName(platform);
    const present = [name, sumName].filter((file) => existsSync(join(dir, file)));
    if (present.length === 0 && !required) continue;
    if (present.length < 2 && required) {
      problems.push(...[name, sumName].filter((file) => !present.includes(file)).map((file) => `Missing ${file}`));
      continue;
    }
    if (present.length < 2) {
      // An optional upload was interrupted between the asset and its checksum.
      const absent = [name, sumName].find((file) => !present.includes(file));
      problems.push(`Incomplete upload: ${present[0]} has no ${absent}`);
      continue;
    }
    const expected = readFileSync(join(dir, sumName), 'utf8').trim().split(/\s+/)[0];
    if (!/^[0-9a-f]{64}$/.test(expected)) problems.push(`${sumName} does not contain a SHA-256 checksum`);
    else if (sha256File(join(dir, name)) !== expected) problems.push(`${name} does not match its checksum in ${sumName}`);
  }
  // Promote publishes every file in the directory, so a file that is not a release asset must stop it: nothing built or
  // attested it.
  const known = new Set(Object.keys(PLATFORMS).flatMap((platform) => [assetName(platform), checksumName(platform)]));
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
export function verifyAttestations(dir, { repository, run = runGh } = {}) {
  if (!repository) throw new Error('Verifying attestations needs the repository, for example countrymanprime/narration-utils.');
  const problems = [];
  for (const [platform, { signerWorkflow }] of Object.entries(PLATFORMS)) {
    for (const name of [assetName(platform), checksumName(platform)]) {
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

const USAGE = 'Usage: assets.mjs package <platform> | assets.mjs verify <dir> [--attestations]';

function verifyCommand(dir, flags) {
  const unknown = flags.find((flag) => flag !== '--attestations');
  if (unknown) {
    console.error(`Unknown flag ${unknown}. ${USAGE}`);
    process.exit(2);
  }
  const problems = verifyAssets(dir);
  if (problems.length) exitWith(problems);
  const shipped = Object.keys(PLATFORMS).filter((platform) => existsSync(join(dir, assetName(platform))));
  console.log(`Verified ${shipped.join(', ')} in ${dir}.`);
  if (!flags.includes('--attestations')) return;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    console.error('--attestations needs GITHUB_REPOSITORY (owner/repo) and an authenticated GitHub CLI.');
    process.exit(2);
  }
  const attestationProblems = verifyAttestations(dir, { repository });
  if (attestationProblems.length) exitWith(attestationProblems);
  console.log(`Every asset and checksum is attested by the release workflows of ${repository}.`);
}

function main([command, argument, ...flags]) {
  if (command === 'package' && argument) {
    const asset = packageAsset({
      platform: argument,
      binDir: process.env.WAILS_BIN_DIR ?? 'apps/desktop/build/bin',
      outDir: process.env.RELEASE_ASSETS_DIR ?? 'release-assets',
    });
    console.log(`Packaged ${asset}`);
  } else if (command === 'verify' && argument) {
    verifyCommand(argument, flags);
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
