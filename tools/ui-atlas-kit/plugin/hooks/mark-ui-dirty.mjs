#!/usr/bin/env node
// PostToolUse hook (matcher Edit|Write|MultiEdit): remember that a UI file changed.
//
// Reads the hook JSON from stdin. When tool_input.file_path is a .tsx/.jsx/.css file or a
// *.stories.* file inside the project, it appends the project-relative path to
// <project>/.ui-atlas/dirty (deduplicated) and always refreshes that file's mtime, so the
// Stop hook can tell whether gate evidence is newer than the latest UI edit.
//
// Only active for a file under a UI root that opted in: a directory between the file and the project
// root that holds ui-atlas.config.json (written by `ui-atlas init`, which may be the project root
// itself or a subfolder such as apps/ui). Everything else is ignored, so the plugin is inert in
// unrelated repos. Never blocks and never prints: it always exits 0.
//
// The project root is CLAUDE_PROJECT_DIR, else the hook input's cwd, else the process cwd. .ui-atlas/
// is local scratch state and is gitignored: the directory carries its own .gitignore containing "*",
// so no edit to the repository's .gitignore is needed (`ui-atlas init` also lists it there).

import { appendFileSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const UI_FILE = /\.(tsx|jsx|css)$/;
const STORY_FILE = /\.stories\./;
const STATE_DIR = '.ui-atlas';
const CONFIG_FILE = 'ui-atlas.config.json';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseInput(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

// Project-relative posix path, or null when the file is outside the project or in node_modules.
function projectRelative(projectDir, filePath) {
  const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(projectDir, filePath);
  const rel = relative(projectDir, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  const posix = rel.split('\\').join('/');
  if (posix.split('/').includes('node_modules') || posix.startsWith(`${STATE_DIR}/`)) return null;
  return posix;
}

function isUiFile(path) {
  return UI_FILE.test(path) || STORY_FILE.test(path);
}

// True when the file sits under a directory (up to and including the project root) with the kit's config.
function underAtlasRoot(projectDir, rel) {
  for (let dir = dirname(join(projectDir, rel)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, CONFIG_FILE))) return true;
    if (dir === projectDir || dirname(dir) === dir) return false;
  }
}

function main() {
  const input = parseInput(readStdin());
  const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const stateDir = join(projectDir, STATE_DIR);

  const filePath = input.tool_input && input.tool_input.file_path;
  if (typeof filePath !== 'string' || filePath === '') return;
  const rel = projectRelative(projectDir, filePath);
  if (rel === null || !isUiFile(rel) || !underAtlasRoot(projectDir, rel)) return;

  mkdirSync(stateDir, { recursive: true });
  const ignoreFile = join(stateDir, '.gitignore');
  if (!existsSync(ignoreFile)) writeFileSync(ignoreFile, '*\n');

  const dirtyFile = join(stateDir, 'dirty');
  const known = existsSync(dirtyFile) ? readFileSync(dirtyFile, 'utf8').split(/\r?\n/) : [];
  if (!known.includes(rel)) appendFileSync(dirtyFile, `${rel}\n`);
  const now = new Date();
  utimesSync(dirtyFile, now, now);
}

try {
  main();
} catch {
  // A bookkeeping hook must never break the edit that triggered it.
}
process.exit(0);
