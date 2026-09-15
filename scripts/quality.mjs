#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const mode = process.argv[2] ?? 'check';
const root = process.cwd();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function stagedFiles() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function python() {
  const local = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';
  return existsSync(local) ? local : process.env.PYTHON ?? 'python';
}

function executable(command) {
  if (process.platform !== 'win32' || !['cargo', 'stylua'].includes(command)) return command;
  const candidate = join(process.env.USERPROFILE ?? '', '.cargo', 'bin', `${command}.exe`);
  return existsSync(candidate) ? candidate : command;
}

function uiBinary(command) {
  const extension = process.platform === 'win32' ? '.cmd' : '';
  return join('node_modules', '.bin', `${command}${extension}`);
}

function runStaged(files) {
  const ui = files.filter((file) => file.startsWith('shared/ui/') && /\.(?:[cm]?[jt]sx?|json|css)$/.test(file));
  const pythonFiles = files.filter((file) => file.endsWith('.py'));
  const rustFiles = files.filter((file) => file.endsWith('.rs') || /(?:^|\/)Cargo(?:\.lock|\.toml)$/.test(file));
  const powershellFiles = files.filter((file) => file.endsWith('.ps1') || file.endsWith('.psm1'));
  const luaFiles = files.filter((file) => file.endsWith('.lua'));

  if (ui.length) {
    const uiRoot = join(root, 'shared', 'ui');
    const uiFiles = ui.map((file) => relative('shared/ui', file));
    run(uiBinary('prettier'), ['--check', ...uiFiles], { cwd: uiRoot });
    run(uiBinary('eslint'), ['--max-warnings', '0', ...uiFiles], { cwd: uiRoot });
  }
  if (pythonFiles.length) {
    run(python(), ['-m', 'ruff', 'format', '--check', ...pythonFiles]);
    run(python(), ['-m', 'ruff', 'check', ...pythonFiles]);
  }
  if (rustFiles.length) run(executable('cargo'), ['fmt', '--all', '--', '--check']);
  if (powershellFiles.length) run('pwsh', ['-NoProfile', '-File', 'scripts/quality/invoke-powershell-analyzer.ps1', ...powershellFiles]);
  if (luaFiles.length) run(executable('stylua'), ['--check', ...luaFiles]);
}

if (mode === 'staged') {
  runStaged(stagedFiles());
  process.exit(0);
}

if (mode !== 'check') {
  console.error(`Unknown quality mode: ${mode}`);
  process.exit(2);
}

run('npm', ['--prefix', 'shared/ui', 'run', 'lint:ci']);
run('npm', ['--prefix', 'shared/ui', 'run', 'format:check']);
run('npm', ['--prefix', 'shared/ui', 'test']);
run('npm', ['--prefix', 'shared/ui', 'run', 'build']);
run(python(), ['-m', 'ruff', 'format', '--check', '.']);
run(python(), ['-m', 'ruff', 'check', '.']);
run(python(), ['-m', 'pytest', '-q', '--basetemp', '.test-tmp']);
run(executable('cargo'), ['fmt', '--all', '--', '--check']);
run(executable('cargo'), ['clippy', '--workspace', '--all-targets', '--', '-D', 'warnings']);
run(executable('cargo'), ['test', '--workspace']);
run('pwsh', ['-NoProfile', '-File', 'scripts/quality/invoke-powershell-analyzer.ps1', 'scripts']);
run(executable('stylua'), ['--check', 'shared/reaper']);
