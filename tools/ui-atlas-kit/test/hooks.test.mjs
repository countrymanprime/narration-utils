import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'hooks');
const MARK = join(HOOKS_DIR, 'mark-ui-dirty.mjs');
const STOP = join(HOOKS_DIR, 'stop-check.mjs');

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ui-atlas-hooks-'));
  // The hooks are opt-in: files count only under a directory holding this file (written by `ui-atlas init`).
  writeFileSync(join(projectDir, 'ui-atlas.config.json'), '{}');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function run(script, input, { env = { CLAUDE_PROJECT_DIR: projectDir }, cwd = projectDir } = {}) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_PROJECT_DIR;
  const result = spawnSync(process.execPath, [script], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    cwd,
    env: { ...cleanEnv, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const edit = (filePath) => ({ tool_name: 'Edit', tool_input: { file_path: filePath } });
const dirtyPath = () => join(projectDir, '.ui-atlas', 'dirty');
const evidencePath = () => join(projectDir, '.ui-atlas', 'gate-evidence');
const dirtyLines = () =>
  readFileSync(dirtyPath(), 'utf8')
    .split('\n')
    .filter((line) => line !== '');

function setMtime(path, seconds) {
  utimesSync(path, seconds, seconds);
}

function markDirtyFile() {
  const result = run(MARK, edit(join(projectDir, 'src', 'Button.tsx')));
  assert.equal(result.status, 0);
  assert.ok(existsSync(dirtyPath()), 'dirty file should exist after a .tsx edit');
}

describe('mark-ui-dirty', () => {
  test('marks a .tsx edit as dirty, silently, with a project-relative path', () => {
    const result = run(MARK, edit(join(projectDir, 'src', 'Button.tsx')));

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.deepEqual(dirtyLines(), ['src/Button.tsx']);
  });

  test('ignores a .md edit', () => {
    const result = run(MARK, edit(join(projectDir, 'docs', 'notes.md')));

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(dirtyPath()), false);
  });

  test('marks .jsx, .css and .stories.* files but not plain .ts', () => {
    for (const file of ['a/View.jsx', 'a/styles.css', 'a/Card.stories.ts', 'a/util.ts']) {
      run(MARK, edit(join(projectDir, file)));
    }

    assert.deepEqual(dirtyLines(), ['a/View.jsx', 'a/styles.css', 'a/Card.stories.ts']);
  });

  test('deduplicates repeated edits and refreshes the mtime', () => {
    markDirtyFile();
    setMtime(dirtyPath(), 1_000_000);

    run(MARK, edit(join(projectDir, 'src', 'Button.tsx')));

    assert.deepEqual(dirtyLines(), ['src/Button.tsx']);
    assert.ok(statSync(dirtyPath()).mtimeMs > 1_000_000 * 1000, 'a repeat edit must invalidate older gate evidence');
  });

  test('accepts a relative file_path and normalises to the project', () => {
    run(MARK, edit('src/Relative.tsx'));

    assert.deepEqual(dirtyLines(), ['src/Relative.tsx']);
  });

  test('ignores files outside the project and inside node_modules', () => {
    const outside = join(tmpdir(), 'ui-atlas-elsewhere', 'Other.tsx');
    run(MARK, edit(outside));
    run(MARK, edit(join(projectDir, 'node_modules', 'pkg', 'index.tsx')));

    assert.equal(existsSync(dirtyPath()), false);
  });

  test('writes a .gitignore inside .ui-atlas so the state is never committed', () => {
    markDirtyFile();

    assert.equal(readFileSync(join(projectDir, '.ui-atlas', '.gitignore'), 'utf8').trim(), '*');
  });

  test('does nothing in a project that has not opted in', () => {
    rmSync(join(projectDir, 'ui-atlas.config.json'));

    const result = run(MARK, edit(join(projectDir, 'src', 'Button.tsx')));

    assert.equal(result.status, 0);
    assert.equal(existsSync(join(projectDir, '.ui-atlas')), false);
  });

  test('when the config lives in a sub-folder UI root, only files under it count', () => {
    rmSync(join(projectDir, 'ui-atlas.config.json'));
    mkdirSync(join(projectDir, 'apps', 'ui'), { recursive: true });
    writeFileSync(join(projectDir, 'apps', 'ui', 'ui-atlas.config.json'), '{}');

    run(MARK, edit(join(projectDir, 'apps', 'ui', 'src', 'Pill.tsx')));
    run(MARK, edit(join(projectDir, 'other', 'Widget.tsx')));

    assert.deepEqual(dirtyLines(), ['apps/ui/src/Pill.tsx']);
  });

  test('falls back to the hook input cwd when CLAUDE_PROJECT_DIR is unset', () => {
    const result = run(MARK, { cwd: projectDir, ...edit(join(projectDir, 'src', 'FromCwd.tsx')) }, { env: {}, cwd: tmpdir() });

    assert.equal(result.status, 0);
    assert.deepEqual(dirtyLines(), ['src/FromCwd.tsx']);
  });

  test('exits 0 on malformed or empty input', () => {
    assert.equal(run(MARK, 'not json').status, 0);
    assert.equal(run(MARK, '').status, 0);
    assert.equal(run(MARK, { tool_input: {} }).status, 0);
    assert.equal(existsSync(dirtyPath()), false);
  });
});

describe('stop-check', () => {
  test('is silent when nothing is dirty', () => {
    const result = run(STOP, { stop_hook_active: false });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  test('is silent when the dirty file is empty', () => {
    mkdirSync(join(projectDir, '.ui-atlas'));
    writeFileSync(dirtyPath(), '\n');

    assert.equal(run(STOP, {}).stdout, '');
  });

  test('blocks when UI files are dirty and there is no gate evidence', () => {
    markDirtyFile();

    const result = run(STOP, { stop_hook_active: false });

    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.decision, 'block');
    assert.match(output.reason, /ui-atlas-gate/);
    assert.match(output.reason, /src\/Button\.tsx/);
  });

  test('blocks when the evidence is older than the latest UI edit', () => {
    markDirtyFile();
    writeFileSync(evidencePath(), 'stale');
    setMtime(evidencePath(), 1_000_000);

    assert.equal(JSON.parse(run(STOP, {}).stdout).decision, 'block');
  });

  test('passes when the evidence is newer than the latest UI edit', () => {
    markDirtyFile();
    writeFileSync(evidencePath(), 'date=now\n');
    const later = statSync(dirtyPath()).mtimeMs / 1000 + 10;
    setMtime(evidencePath(), later);

    const result = run(STOP, {});

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  test('passes without checking anything when stop_hook_active is true', () => {
    markDirtyFile();

    const result = run(STOP, { stop_hook_active: true });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  test('is silent in a project where no UI edit was ever recorded', () => {
    const result = run(STOP, { stop_hook_active: false });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(join(projectDir, '.ui-atlas')), false);
  });

  test('exits 0 on malformed input rather than trapping the agent', () => {
    markDirtyFile();

    const result = run(STOP, 'not json');

    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).decision, 'block');
  });
});

describe('hooks.json', () => {
  const config = JSON.parse(readFileSync(join(HOOKS_DIR, 'hooks.json'), 'utf8'));

  test('wires PostToolUse to mark-ui-dirty for Edit, Write and MultiEdit', () => {
    const entry = config.hooks.PostToolUse[0];

    assert.equal(entry.matcher, 'Edit|Write|MultiEdit');
    assert.equal(entry.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/mark-ui-dirty.mjs"');
  });

  test('wires Stop to stop-check', () => {
    assert.equal(config.hooks.Stop[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop-check.mjs"');
  });
});
