// The repository layout contract: which top-level entries may exist, and the old-to-new path
// map that migrates text (docs, scripts, configs, open branches) when a directory moves.
// The data lives in layout.json; docs/architecture/codebase-map.md explains the layout itself.
//
// applyPathMap rewrites only slash-joined paths (`apps/ui/x`, `../apps/desktop/app.go`). The guard also
// reports forms a mechanical rewrite cannot do safely, from the `patterns` in layout.json: bare
// directory names (`go -C <dir>`), quoted path segments (`join(root, '<dir>', '<sub>')`) and
// backslash paths. Fix those by hand.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAYOUT_FILE = join(HERE, 'layout.json');
export const REPO_ROOT = join(HERE, '..', '..');

// A path starts where the previous character is not part of a name, and never inside the Go
// module path (github.com/countrymanprime/narration-utils/shell/...), which the layout keeps.
const PATH_START = '(?<![A-Za-z0-9_.-])(?<!narration-utils/)';
// A directory name ends where the next character is not part of a name. A `from` that already
// ends in a slash is a directory prefix and needs no end check.
const NAME_END = '(?![A-Za-z0-9_-])';

export function loadLayout() {
  return JSON.parse(readFileSync(LAYOUT_FILE, 'utf8'));
}

export function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
}

/** Text of every tracked file that is not binary, keyed by repo-relative path. */
export function readTrackedText(files) {
  const result = new Map();
  for (const file of files) {
    // A file that is listed but not readable (deleted in the working tree, say) has no text to check.
    const buffer = readOrNull(join(REPO_ROOT, file));
    if (buffer && !buffer.includes(0)) result.set(file, buffer.toString('utf8'));
  }
  return result;
}

function readOrNull(path) {
  try {
    return readFileSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPattern(renames, flags) {
  if (renames.length === 0) return new RegExp('(?!)', flags); // nothing retired, nothing matches
  const froms = renames.map((rename) => rename.from).sort((a, b) => b.length - a.length);
  const alternatives = froms.map((from) => (from.endsWith('/') ? escapeRegExp(from) : `${escapeRegExp(from)}${NAME_END}`));
  return new RegExp(`${PATH_START}(?:${alternatives.join('|')})`, flags);
}

/** Rewrites every repo path in `text` that starts with a `from` prefix, most specific prefix first. */
export function applyPathMap(text, renames) {
  const targets = new Map(renames.map((rename) => [rename.from, rename.to]));
  return text.replace(buildPattern(renames, 'g'), (match) => targets.get(match));
}

export function isHistorical(file, historical) {
  return historical.some((entry) => file === entry || (entry.endsWith('/') && file.startsWith(entry)));
}

/** Lines that still name a retired path, in files that are not historical records. */
export function findStaleReferences(filesByPath, renames, historical, patterns = []) {
  const stale = [];
  const slashForms = buildPattern(renames, '');
  const otherForms = patterns.map((source) => new RegExp(source));
  const retired = { test: (line) => slashForms.test(line) || otherForms.some((pattern) => pattern.test(line)) };
  for (const [file, text] of filesByPath) {
    if (isHistorical(file, historical)) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      if (retired.test(line)) stale.push({ file, line: index + 1, text: line.trim() });
    });
  }
  return stale;
}

/** Top-level entries of the tracked files that the allowlist does not name. */
export function unexpectedRoots(files, allowed) {
  const roots = new Set(files.map((file) => file.split('/')[0]));
  return [...roots].filter((root) => !allowed.includes(root)).sort();
}
