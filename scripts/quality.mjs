#!/usr/bin/env node

import { existsSync } from 'node:fs';
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
  return files.filter((file) => file.startsWith('shared/ui/') && !file.startsWith('shared/ui/wailsjs/') && /\.(?:[cm]?[jt]sx?|json|css)$/.test(file));
}

function uiLintFiles(files) {
  return files.filter((file) => file.startsWith('shared/ui/') && !file.startsWith('shared/ui/wailsjs/') && /\.(?:[cm]?[jt]sx?)$/.test(file));
}

function fixStaged(files, fixer) {
  const rootFiles = files.map(rootRelative);
  const ui = uiFormattingFiles(rootFiles);
  const uiLint = uiLintFiles(rootFiles);
  const pythonFiles = rootFiles.filter((file) => file.endsWith('.py'));
  const goFiles = rootFiles.filter((file) => file.startsWith('shell/') && file.endsWith('.go'));
  const luaFiles = rootFiles.filter((file) => file.endsWith('.lua'));

  if (fixer === 'ui' && ui.length) {
    const uiRoot = join(root, 'shared', 'ui');
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
  if (fixer === 'go' && goFiles.length) run('go', ['-C', 'shell', 'fmt', './...']);
  if (fixer === 'lua' && luaFiles.length) run(executable('stylua'), [...luaFiles]);
}

function checkStagedFiles(files, checker) {
  const rootFiles = files.map(rootRelative);
  const ui = uiFormattingFiles(rootFiles);
  const uiLint = uiLintFiles(rootFiles);
  const pythonFiles = rootFiles.filter((file) => file.endsWith('.py'));
  const goFiles = rootFiles.filter((file) => file.startsWith('shell/') && file.endsWith('.go'));
  const luaFiles = rootFiles.filter((file) => file.endsWith('.lua'));

  if (checker === 'ui' && ui.length) {
    const uiRoot = join(root, 'shared', 'ui');
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
    run('go', ['-C', 'shell', 'vet', './...']);
  }
  if (checker === 'lua' && luaFiles.length) run(executable('stylua'), ['--check', ...luaFiles]);
}

function runStaged(files) {
  const ui = uiFormattingFiles(files);
  const uiLint = uiLintFiles(files);
  const pythonFiles = files.filter((file) => file.endsWith('.py'));
  const goFiles = files.filter((file) => file.startsWith('shell/') && file.endsWith('.go'));
  const luaFiles = files.filter((file) => file.endsWith('.lua'));

  if (ui.length) {
    const uiRoot = join(root, 'shared', 'ui');
    const uiFiles = ui.map((file) => relative('shared/ui', file));
    run(uiBinary('prettier'), ['--check', ...uiFiles], { cwd: uiRoot });
    if (uiLint.length) {
      const uiLintFiles = uiLint.map((file) => relative('shared/ui', file));
      run(uiBinary('eslint'), ['--max-warnings', '0', ...uiLintFiles], { cwd: uiRoot });
    }
  }
  if (pythonFiles.length) {
    run(python(), ['-m', 'ruff', 'format', '--check', ...pythonFiles]);
    run(python(), ['-m', 'ruff', 'check', ...pythonFiles]);
  }
  if (goFiles.length) {
    checkGofmt(goFiles);
    run('go', ['-C', 'shell', 'vet', './...']);
    run('go', ['-C', 'shell', 'test', './...']);
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

if (mode !== 'check') {
  console.error(`Unknown quality mode: ${mode}`);
  process.exit(2);
}

run('pnpm', ['--dir', 'shared/ui', 'run', 'lint:ci']);
run('pnpm', ['--dir', 'shared/ui', 'run', 'format:check']);
run('pnpm', ['--dir', 'shared/ui', 'test']);
run('pnpm', ['--dir', 'shared/ui', 'run', 'build']);
run(python(), ['-m', 'ruff', 'format', '--check', '.']);
run(python(), ['-m', 'ruff', 'check', '.']);
// A fixed pytest base directory is prone to Windows file-handle races after a
// previous test process exits. Keep every quality run isolated; the directory
// is ignored and pytest owns its own cleanup within that run.
run(python(), ['-m', 'pytest', '-q', '--basetemp', `.test-tmp-${process.pid}`]);
run('go', ['-C', 'shell', 'vet', './...']);
run('go', ['-C', 'shell', 'test', './...']);
run('staticcheck', ['./...'], { cwd: join(root, 'shell') });
run('stylua', ['--check', 'shared/reaper']);
run('node', ['--test', 'scripts/github/*.test.mjs']);
