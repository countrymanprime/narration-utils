#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { gateParallelism, workspaceWideChanges } from './ci/local-gate.mjs';

const mode = process.argv[2] ?? 'check';
const root = process.cwd();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function stagedFiles() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function python() {
  const local = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';
  return existsSync(local) ? local : (process.env.PYTHON ?? 'python');
}

function executable(command) { return command; }

function checkGofmt(files) {
  const result = spawnSync('gofmt', ['-l', ...files], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (result.stdout.trim()) {
    console.error(`Run gofmt on:\n${result.stdout.trim()}`);
    process.exit(1);
  }
}

function uiBinary(command) {
  const extension = process.platform === 'win32' ? '.cmd' : '';
  return join('node_modules', '.bin', `${command}${extension}`);
}

function rootRelative(file) {
  return relative(root, isAbsolute(file) ? file : join(root, file)).replaceAll('\\', '/');
}

function uiFormattingFiles(files) {
  return files.filter((file) => file.startsWith('apps/ui/') && !file.startsWith('apps/ui/wailsjs/') && /\.(?:[cm]?[jt]sx?|json|css)$/.test(file));
}

function uiLintFiles(files) {
  return files.filter((file) => file.startsWith('apps/ui/') && !file.startsWith('apps/ui/wailsjs/') && /\.(?:[cm]?[jt]sx?)$/.test(file));
}

function fixStaged(files, fixer) {
  const rootFiles = files.map(rootRelative);
  const ui = uiFormattingFiles(rootFiles);
  const uiLint = uiLintFiles(rootFiles);
  const pythonFiles = rootFiles.filter((file) => file.endsWith('.py'));
  const goFiles = rootFiles.filter((file) => file.startsWith('apps/desktop/') && file.endsWith('.go'));
  const luaFiles = rootFiles.filter((file) => file.endsWith('.lua'));

  if (fixer === 'ui' && ui.length) {
    const uiRoot = join(root, 'apps', 'ui');
    const uiFiles = ui.map((file) => relative(uiRoot, join(root, file)));
    run(uiBinary('prettier'), ['--write', ...uiFiles], { cwd: uiRoot });
    if (uiLint.length) {
      const uiLintFiles = uiLint.map((file) => relative(uiRoot, join(root, file)));
      run(uiBinary('eslint'), ['--fix', ...uiLintFiles], { cwd: uiRoot });
    }
  }
  if (fixer === 'python' && pythonFiles.length) {
    run(python(), ['-m', 'ruff', 'format', ...pythonFiles]);
    run(python(), ['-m', 'ruff', 'check', '--fix', ...pythonFiles]);
  }
  if (fixer === 'go' && goFiles.length) run('go', ['-C', 'apps/desktop', 'fmt', './...']);
  if (fixer === 'lua' && luaFiles.length) run(executable('stylua'), [...luaFiles]);
}

function checkStagedFiles(files, checker) {
  const rootFiles = files.map(rootRelative);
  const ui = uiFormattingFiles(rootFiles);
  const uiLint = uiLintFiles(rootFiles);
  const pythonFiles = rootFiles.filter((file) => file.endsWith('.py'));
  const goFiles = rootFiles.filter((file) => file.startsWith('apps/desktop/') && file.endsWith('.go'));
  const luaFiles = rootFiles.filter((file) => file.endsWith('.lua'));

  if (checker === 'ui' && ui.length) {
    const uiRoot = join(root, 'apps', 'ui');
    const uiFiles = ui.map((file) => relative(uiRoot, join(root, file)));
    run(uiBinary('prettier'), ['--check', ...uiFiles], { cwd: uiRoot });
    if (uiLint.length) {
      const uiLintFiles = uiLint.map((file) => relative(uiRoot, join(root, file)));
      run(uiBinary('eslint'), ['--max-warnings', '0', ...uiLintFiles], { cwd: uiRoot });
    }
  }
  if (checker === 'python' && pythonFiles.length) {
    run(python(), ['-m', 'ruff', 'format', '--check', ...pythonFiles]);
    run(python(), ['-m', 'ruff', 'check', ...pythonFiles]);
  }
  if (checker === 'go' && goFiles.length) {
    checkGofmt(goFiles);
    run('go', ['-C', 'apps/desktop', 'vet', './...']);
  }
  if (checker === 'lua' && luaFiles.length) run(executable('stylua'), ['--check', ...luaFiles]);
}

function runStaged(files) {
  const ui = uiFormattingFiles(files);
  const uiLint = uiLintFiles(files);
  const pythonFiles = files.filter((file) => file.endsWith('.py'));
  const goFiles = files.filter((file) => file.startsWith('apps/desktop/') && file.endsWith('.go'));
  const luaFiles = files.filter((file) => file.endsWith('.lua'));

  if (ui.length) {
    const uiRoot = join(root, 'apps', 'ui');
    const uiFiles = ui.map((file) => relative('apps/ui', file));
    run(uiBinary('prettier'), ['--check', ...uiFiles], { cwd: uiRoot });
    if (uiLint.length) {
      const uiLintFiles = uiLint.map((file) => relative('apps/ui', file));
      run(uiBinary('eslint'), ['--max-warnings', '0', ...uiLintFiles], { cwd: uiRoot });
    }
  }
  if (pythonFiles.length) {
    run(python(), ['-m', 'ruff', 'format', '--check', ...pythonFiles]);
    run(python(), ['-m', 'ruff', 'check', ...pythonFiles]);
  }
  if (goFiles.length) {
    checkGofmt(goFiles);
    run('go', ['-C', 'apps/desktop', 'vet', './...']);
    run('go', ['-C', 'apps/desktop', 'test', './...']);
  }
  if (luaFiles.length) run(executable('stylua'), ['--check', ...luaFiles]);
}

if (mode === 'staged') {
  runStaged(stagedFiles());
  process.exit(0);
}

if (mode.startsWith('fix-')) {
  fixStaged(process.argv.slice(3), mode.slice('fix-'.length));
  process.exit(0);
}

if (mode.startsWith('check-')) {
  checkStagedFiles(process.argv.slice(3), mode.slice('check-'.length));
  process.exit(0);
}

// Modes the Nx targets call (see each project's project.json). They exist so that every project
// runs the repo's own interpreter and formatting rules, wherever Nx starts the command.
if (mode === 'python') {
  run(python(), process.argv.slice(3));
  process.exit(0);
}

if (mode === 'pytest') {
  // A fixed pytest base directory is prone to Windows file-handle races after a previous test
  // process exits. Keep every run isolated; the directory lives under the ignored .cache/ folder
  // (not the repo root) and pytest owns its own cleanup within that run. pytest creates the
  // directory but not its parent.
  mkdirSync(join(root, '.cache'), { recursive: true });
  run(python(), ['-m', 'pytest', '-q', '--basetemp', `.cache/test-tmp-${process.pid}`, ...process.argv.slice(3)]);
  process.exit(0);
}

if (mode === 'go-lint') {
  const dir = process.argv[3];
  if (!dir) {
    console.error('go-lint needs the Go module directory.');
    process.exit(2);
  }
  checkGofmt([dir]);
  run('go', ['-C', dir, 'vet', './...']);
  // golangci-lint v2 (config: <dir>/.golangci.yml): errcheck, govet, staticcheck, unused, ineffassign and gosec.
  run('golangci-lint', ['run', './...'], { cwd: join(root, dir) });
  // gVisor's checklocks: a field annotated `// +checklocks:mu` is only touched with mu held, and a field that is
  // always used under a lock but has no annotation is reported too, so a new guarded field gets one. Product code
  // only (-test=false): tests set seams on a Host no goroutine can see yet, and the race detector covers them.
  run('checklocks', ['-test=false', './...'], { cwd: join(root, dir) });
  process.exit(0);
}

if (mode !== 'check' && mode !== 'affected') {
  console.error(`Unknown quality mode: ${mode}`);
  process.exit(2);
}

const GATE_TARGETS = ['lint', 'format', 'architecture', 'knip', 'test', 'test-node', 'build'];
// Never from the Nx cache (a green gate must mean the checks ran). Tasks run side by side on a developer's machine, half
// the CPUs by default and NX_PARALLEL=1 for one at a time; CI's own jobs run one at a time (scripts/ci/local-gate.mjs).
const GATE_ARGS = ['--skip-nx-cache', `--parallel=${gateParallelism({ cpus: availableParallelism() })}`, '--nx-bail', '--output-style=stream'];
// The projects CI checks on every pull request whatever it changes (`always` in .github/workflows/_quality.yml): Knip reads
// every workspace, the layout and project guards every tracked file, the atlas kit's drift check apps/ui, the docs site docs/.
const ALWAYS = ['narration-utils', 'repo-scripts', 'ui-atlas-kit', 'docs-site'];

function gitLines(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

if (mode === 'affected') {
  // A quicker gate while working: only the projects the branch changes (committed since it left the base, staged, unstaged or
  // untracked), plus ALWAYS, as CI scopes a pull request. Everything when a workspace-wide file changed, as CI does
  // (scripts/ci/nx-scope.sh). `pnpm check` is still the gate before calling a change done.
  const base = process.env.NX_BASE ?? 'origin/main';
  const changed = [
    ...new Set([...gitLines(['diff', '--name-only', `${base}...HEAD`]), ...gitLines(['diff', '--name-only', 'HEAD']), ...gitLines(['ls-files', '--others', '--exclude-standard'])]),
  ];
  const wide = workspaceWideChanges(changed);
  if (wide.length > 0) {
    console.log(`Workspace-wide change (${wide.slice(0, 3).join(', ')}${wide.length > 3 ? ', ...' : ''}): checking every project.`);
    run('pnpm', ['exec', 'nx', 'run-many', '-t', ...GATE_TARGETS, ...GATE_ARGS]);
    process.exit(0);
  }
  let affected = [];
  if (changed.length) {
    const shown = spawnSync('pnpm', ['exec', 'nx', 'show', 'projects', '--affected', `--files=${changed.join(',')}`, '--json'], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    // Never "nothing affected" because Nx failed: that would pass a gate that checked nothing.
    if (shown.status !== 0) {
      console.error(shown.stderr.trim());
      process.exit(shown.status ?? 1);
    }
    affected = JSON.parse(shown.stdout);
  }
  const projects = [...new Set([...affected, ...ALWAYS])];
  console.log(`${changed.length} changed file(s) against ${base}; checking ${projects.join(', ')}.`);
  run('pnpm', ['exec', 'nx', 'run-many', '-t', ...GATE_TARGETS, `--projects=${projects.join(',')}`, ...GATE_ARGS]);
  process.exit(0);
}

// The full gate: every project's lint, format, knip, test, test-node and build target. CI runs the same targets with
// `nx affected` (see .github/actions/nx-run).
run('pnpm', ['exec', 'nx', 'run-many', '-t', ...GATE_TARGETS, ...GATE_ARGS]);
