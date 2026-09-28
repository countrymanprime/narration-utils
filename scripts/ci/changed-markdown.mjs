// Finds the Markdown files a change adds or modifies against a base ref (ADR 0415): the input to
// `Docs / Markdown lint (changed files)` (.github/workflows/docs.yml) and `pnpm lint:md[:fix]`
// (lint-markdown-changed.mjs). Deliberately not a full-repo baseline: `Docs / Links (offline)` already lints every
// Markdown file's links with lychee, and a repo-wide markdownlint sweep is its own future change.

import { execFileSync } from 'node:child_process';

/**
 * Parses `git diff --name-status -z <range>` output into the paths a change touches. A rename or copy (`R100`,
 * `C75`) carries two paths, old then new; only the new path can still be linted. A deleted file (excluded by
 * `--diff-filter=ACMR` before this ever sees it) would carry no path worth linting either way.
 */
export function parseChangedFiles(nameStatusOutputNulSeparated) {
  const fields = nameStatusOutputNulSeparated.split('\0').filter((field) => field !== '');
  const files = [];
  let index = 0;
  while (index < fields.length) {
    const status = fields[index++];
    if (status.startsWith('R') || status.startsWith('C')) index++; // skip the old path
    files.push(fields[index++]);
  }
  return files;
}

export function isMarkdownFile(file) {
  return file.toLowerCase().endsWith('.md');
}

/** The Markdown files added, copied, modified or renamed-into between `base` and `head` (a merge-base diff, so a
 *  `head` that is behind `base` reports nothing new rather than every file `base` has moved on without). */
export function changedMarkdownFiles({ base, head = 'HEAD', cwd = process.cwd() } = {}) {
  const mergeBase = execFileSync('git', ['merge-base', base, head], { cwd, encoding: 'utf8' }).trim();
  const output = execFileSync('git', ['diff', '--name-status', '-z', '--diff-filter=ACMR', `${mergeBase}...${head}`], {
    cwd,
    encoding: 'utf8',
  });
  return parseChangedFiles(output).filter(isMarkdownFile);
}

/** Whether `ref` names a commit in the repository at `cwd`. */
export function refExists(ref, cwd = process.cwd()) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The ref to diff a change against: `origin/<baseRef>` (a pull request's base, GITHUB_BASE_REF in CI), or `origin/main`
 * outside a pull request. A pull request stacked on another branch has a checkout that holds `origin/main` but not
 * `origin/<baseRef>`; its HEAD is then GitHub's merge commit, whose first parent is the base's tip, so `HEAD^1` stands in.
 */
export function resolveBase({ baseRef, hasRef = refExists } = {}) {
  if (!baseRef) return 'origin/main';
  const remote = `origin/${baseRef}`;
  return hasRef(remote) ? remote : 'HEAD^1';
}
