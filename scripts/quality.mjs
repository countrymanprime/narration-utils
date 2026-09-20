#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

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
  run('staticcheck', ['./...'], { cwd: join(root, dir) });
  process.exit(0);
}

if (mode !== 'check') {
  console.error(`Unknown quality mode: ${mode}`);
  process.exit(2);
}

// The full gate: every project's lint, format, test, test-node and build target, one at a time, never from
// the Nx cache (a green gate must mean the checks ran). CI runs the same targets with
// `nx affected` (see .github/actions/nx-run).
run('pnpm', ['exec', 'nx', 'run-many', '-t', 'lint', 'format', 'test', 'test-node', 'build', '--skip-nx-cache', '--parallel=1', '--nx-bail', '--output-style=stream']);
