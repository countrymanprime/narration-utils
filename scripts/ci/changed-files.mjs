#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BOOTSTRAP_INPUTS = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pyproject.toml',
  'uv.lock',
  'apps/desktop/package.json',
  'apps/ui/package.json',
  'pnpm-workspace.yaml',
]);

const NON_RUNTIME_FILES = new Set(['.editorconfig', '.gitattributes', '.gitignore', '.github/pull_request_template.md', 'LICENSE', 'LICENSE.md']);

export function needsBootstrap(files) {
  return files.some(
    (file) =>
      BOOTSTRAP_INPUTS.has(file) ||
	  file === 'apps/desktop/go.mod' ||
	  file === 'apps/desktop/go.sum' ||
      file === 'scripts/bootstrap.mjs' ||
      file === 'scripts/bootstrap.test.mjs',
  );
}

export function isNonRuntimeMetadata(file) {
  return NON_RUNTIME_FILES.has(file) || file.startsWith('docs/') || file.startsWith('.github/ISSUE_TEMPLATE/') || file.endsWith('.md');
}

export function classifyFiles(files, { exhaustive = false } = {}) {
  if (exhaustive) return { bootstrap: true, package: true };
  return {
    bootstrap: needsBootstrap(files),
    // Only an explicit documentation or metadata-only change can skip native
    // packages. New paths remain package-affecting until deliberately
    // classified, which keeps release coverage fail-safe.
    package: files.some((file) => !isNonRuntimeMetadata(file)),
  };
}

export function changedFiles(base, head) {
  return execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
}

function main() {
  const [base, head] = process.argv.slice(2);
  const exhaustive = process.env.GITHUB_EVENT_NAME !== 'pull_request';
  if (!exhaustive && (!base || !head)) {
    throw new Error('Pull request classification requires base and head commit SHAs.');
  }
  const scope = classifyFiles(exhaustive ? [] : changedFiles(base, head), { exhaustive });
  process.stdout.write(`bootstrap=${scope.bootstrap}\npackage=${scope.package}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
