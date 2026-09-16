import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapCommands, buildCommands, localPaths, localPython, parseOptions, pythonVersionError, runBootstrap } from './bootstrap.mjs';

test('parses supported options and rejects conflicting installs', () => {
  assert.deepEqual(parseOptions(['--python', '/opt/python', '--skip-install']), { python: '/opt/python', skipInstall: true, refresh: false, release: false });
  assert.deepEqual(parseOptions(['--release']), { python: undefined, skipInstall: false, refresh: false, release: true });
  assert.throws(() => parseOptions(['--skip-install', '--refresh']), /cannot be used together/);
  assert.throws(() => parseOptions(['--unknown']), /Unknown bootstrap option/);
});

test('uses platform-specific virtual-environment paths', () => {
  assert.equal(localPython('C:\\repo', 'win32'), 'C:\\repo\\.venv\\Scripts\\python.exe');
  assert.equal(localPython('/repo', 'linux'), '/repo/.venv/bin/python');
  assert.equal(localPaths('/repo', 'darwin').length, 4);
});

test('build plan installs locked dependencies and defaults to a debug workspace build', () => {
  const commands = bootstrapCommands('/repo', 'python3', 'linux');
  assert.deepEqual(commands[1], ['/repo/.venv/bin/python', ['-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', 'requirements.lock']]);
  const builds = buildCommands();
  assert.ok(builds.some(([command, args]) => command === 'cargo' && args.join(' ') === 'build --workspace'));
  assert.ok(builds.every(([, args]) => !args.includes('--release')));
  const releaseBuilds = buildCommands({ release: true });
  assert.ok(releaseBuilds.some(([command, args]) => command === 'cargo' && args.join(' ') === 'build --workspace --release'));
  assert.ok([...commands, ...builds].every(([, args]) => !args.join(' ').includes('prepare-resources')));
  assert.ok([...commands, ...builds].every(([, args]) => !args.join(' ').includes('tauri build')));
});

test('uses the Windows Python launcher only when no executable was selected', () => {
  const commands = bootstrapCommands('C:\\repo', 'py', 'win32', ['-3.12']);
  assert.deepEqual(commands[0], ['py', ['-3.12', '-m', 'venv', '.venv']]);
});

test('runs setup commands in order and reports subprocess failure', () => {
  const calls = [];
  runBootstrap(
    { python: 'python3', skipInstall: false, refresh: false, release: false },
    { root: '/repo', platform: 'linux', skipPreflight: true, run: (command, args) => calls.push([command, args]), log: () => {} },
  );
  assert.equal(calls[0][0], 'python3');
  assert.equal(calls.at(-1)[0], 'cargo');
  assert.throws(
    () =>
      runBootstrap(
        { python: 'python3', skipInstall: false, refresh: false, release: false },
        {
          root: '/repo',
          platform: 'linux',
          skipPreflight: true,
          run: () => {
            throw new Error('network unavailable');
          },
          log: () => {},
        },
      ),
    /network unavailable/,
  );
});

test('keeps an existing virtual environment while reconciling locked dependencies', () => {
  const calls = [];
  runBootstrap(
    { python: 'python3', skipInstall: false, refresh: false, release: false },
    {
      root: '/repo',
      platform: 'linux',
      skipPreflight: true,
      exists: (path) => path.endsWith('/.venv/bin/python'),
      run: (command, args) => calls.push([command, args]),
      log: () => {},
    },
  );
  assert.deepEqual(calls[0], ['/repo/.venv/bin/python', ['-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', 'requirements.lock']]);
});

test('skip install still builds existing environments', () => {
  const calls = [];
  runBootstrap(
    { skipInstall: true, refresh: false, release: false },
    { root: '/repo', platform: 'linux', skipPreflight: true, exists: () => true, run: (command, args) => calls.push([command, args]), log: () => {} },
  );
  assert.deepEqual(calls, buildCommands());
});

test('release mode requests the release workspace build', () => {
  const calls = [];
  runBootstrap(
    { skipInstall: true, refresh: false, release: true },
    { root: '/repo', platform: 'linux', skipPreflight: true, exists: () => true, run: (command, args) => calls.push([command, args]), log: () => {} },
  );
  assert.deepEqual(calls, buildCommands({ release: true }));
});

test('skip install requires every local environment', () => {
  assert.throws(
    () =>
      runBootstrap(
        { skipInstall: true, refresh: false, release: false },
        { root: '/repo', platform: 'linux', skipPreflight: true, exists: () => false, log: () => {} },
      ),
    /requires existing local paths/,
  );
});

test('reports how to select the required Python version', () => {
  assert.match(pythonVersionError(new Error('python must be version 3.12; found 3.13.')), /Install Python 3\.12 or rerun with --python <path-to-python-3\.12>/);
});
