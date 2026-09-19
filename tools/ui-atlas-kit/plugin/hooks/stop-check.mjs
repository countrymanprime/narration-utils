#!/usr/bin/env node
// Stop hook: do not let the agent end a turn with unverified UI edits.
//
// Silent (exit 0, no output) unless .ui-atlas/dirty lists at least one UI file AND
// .ui-atlas/gate-evidence is missing or older than .ui-atlas/dirty. In that case it prints
//   {"decision":"block","reason":"..."}
// to stdout, which makes Claude Code continue the turn with the reason as the instruction.
//
// Loop guard: when the hook input has stop_hook_active === true, Claude is already continuing
// because of a Stop hook, so this exits 0 and lets it stop. The agent gets one prompt per turn
// to run the gate (skill ui-atlas-gate) or to explain, in its final message, why it is skipping it.
//
// Opt-in is implicit: .ui-atlas/dirty is only ever written by mark-ui-dirty.mjs, which acts only for
// files under a directory that has ui-atlas.config.json. The project root is CLAUDE_PROJECT_DIR, else the
// hook input's cwd, else the process cwd.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STATE_DIR = '.ui-atlas';
const LISTED_FILES = 5;

function readInput() {
  try {
    const value = JSON.parse(readFileSync(0, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function dirtyFiles(dirtyFile) {
  return readFileSync(dirtyFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function evidenceIsFresh(evidenceFile, dirtyFile) {
  return existsSync(evidenceFile) && statSync(evidenceFile).mtimeMs >= statSync(dirtyFile).mtimeMs;
}

function blockReason(files) {
  const shown = files.slice(0, LISTED_FILES).join(', ');
  const more = files.length > LISTED_FILES ? ` and ${files.length - LISTED_FILES} more` : '';
  return (
    `UI files were edited (${shown}${more}) but there is no fresh gate evidence in .ui-atlas/gate-evidence. ` +
    'Run the ui-atlas-gate skill (unit, lint, format, build, app visual suite, atlas, then view the screenshots) ' +
    'and write the evidence file, or state explicitly in your final message why the gate is being skipped.'
  );
}

function main() {
  const input = readInput();
  if (input.stop_hook_active === true) return;

  const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const stateDir = join(projectDir, STATE_DIR);

  const dirtyFile = join(stateDir, 'dirty');
  if (!existsSync(dirtyFile)) return;
  const files = dirtyFiles(dirtyFile);
  if (files.length === 0) return;
  if (evidenceIsFresh(join(stateDir, 'gate-evidence'), dirtyFile)) return;

  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: blockReason(files) })}\n`);
}

try {
  main();
} catch {
  // A broken check must not trap the agent in a turn it cannot end.
}
process.exit(0);
