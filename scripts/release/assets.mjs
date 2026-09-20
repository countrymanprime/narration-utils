#!/usr/bin/env node

// Names, packages and verifies the one downloadable per platform:
// narration-utils-<platform>.<ext> plus a narration-utils-<platform>.<ext>.sha256 beside it.
// Every platform builds and uploads its own asset at a different time, so checksums are per
// asset rather than one SHA256SUMS.txt that would need every platform to have finished.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHELL_BINARY = 'narration-utils-shell';
const MAC_APP_BUNDLE = 'Narration Utils.app';

function requireInBin(binDir, name) {
  if (!existsSync(join(binDir, name))) throw new Error(`Expected ${name} in ${binDir}; did the Wails build run?`);
}

// `archive` turns Wails' output in binDir into the asset at `target` (an absolute path in `outDir`).
// `required` platforms must be on a release before it can be promoted; the others ship when their
// (separate, re-runnable) build succeeds and are simply absent when it did not.
export const PLATFORMS = {
  // The runner has no NSIS, so `wails build -nsis` only warns and the raw self-contained exe is the
  // real output. It is zipped (about 400 MB otherwise) and keeps the name the REAPER launcher looks for.
  'windows-x64': {
    extension: '.zip',
    required: true,
    archive({ binDir, outDir, target }) {
      requireInBin(binDir, `${SHELL_BINARY}.exe`);
      // Windows' bsdtar writes zips (-a picks the format from the name). Git Bash's GNU tar comes
      // first on PATH there and cannot, so call the system one by path.
      const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
      execFileSync(tar, ['-a', '-cf', basename(target), '-C', binDir, `${SHELL_BINARY}.exe`], { cwd: outDir, stdio: 'inherit' });
    },
  },
  // A .app is a directory, so it has to be archived. -y keeps symlinks inside the bundle.
  'macos-arm64': {
    extension: '.zip',
    required: false,
    archive({ binDir, target }) {
      requireInBin(binDir, MAC_APP_BUNDLE);
      execFileSync('zip', ['-r', '-y', target, MAC_APP_BUNDLE], { cwd: binDir, stdio: 'inherit' });
    },
  },
  // tar keeps the executable bit, which a bare release download would lose.
  'linux-x64': {
    extension: '.tar.gz',
    required: false,
    archive({ binDir, outDir, target }) {
      requireInBin(binDir, SHELL_BINARY);
      // A relative archive name plus -C keeps a Windows drive letter out of tar's archive argument.
      execFileSync('tar', ['-czf', basename(target), '-C', binDir, SHELL_BINARY], { cwd: outDir, stdio: 'inherit' });
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
  return problems;
}

function main([command, argument]) {
  if (command === 'package' && argument) {
    const asset = packageAsset({
      platform: argument,
      binDir: process.env.WAILS_BIN_DIR ?? 'apps/desktop/build/bin',
      outDir: process.env.RELEASE_ASSETS_DIR ?? 'release-assets',
    });
    console.log(`Packaged ${asset}`);
  } else if (command === 'verify' && argument) {
    const problems = verifyAssets(argument);
    if (problems.length) {
      console.error(problems.map((problem) => `- ${problem}`).join('\n'));
      process.exit(1);
    }
    const shipped = Object.keys(PLATFORMS).filter((platform) => existsSync(join(argument, assetName(platform))));
    console.log(`Verified ${shipped.join(', ')} in ${argument}.`);
  } else {
    console.error('Usage: assets.mjs package <platform> | assets.mjs verify <dir>');
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
