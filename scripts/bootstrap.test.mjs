import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootstrapCommands,
  buildCommands,
  GO_VERSION,
  localToolPaths,
  localPaths,
  localPython,
  parseOptions,
  PNPM_VERSION,
  pythonVersionError,
  runBootstrap,
  STATICCHECK_VERSION,
  STYLUA_VERSION,
  UV_VERSION,
  WAILS_VERSION,
} from './bootstrap.mjs';

test('reads all pinned Go/Wails quality-tool versions from the toolchain manifest', () => {
  assert.equal(PNPM_VERSION, '11.27.0');
  assert.equal(UV_VERSION, '0.12.15');
  assert.equal(GO_VERSION, '1.27.1');
  assert.equal(WAILS_VERSION, 'v2.16.0');
  assert.equal(STATICCHECK_VERSION, 'v0.8.1');
  assert.equal(STYLUA_VERSION, 'v2.1.0');
});

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

test('prefers the pinned repo-local Go and Wails tool directories', () => {
  assert.deepEqual(localToolPaths('C:\\repo', 'win32'), ['C:\\repo\\.tools\\go-1.27.1\\go\\bin', 'C:\\repo\\.tools\\go-bin', 'C:\\repo\\.tools\\wails-bin']);
});

test('build plan installs locked dependencies and creates a production-like workspace binary', () => {
  const commands = bootstrapCommands('/repo', 'python3', 'linux');
  assert.deepEqual(commands[1], ['uv', ['sync', '--locked']]);
  assert.ok(commands.some(([command, args]) => command === 'pnpm' && args.join(' ') === 'install --frozen-lockfile'));
  const builds = buildCommands();
  assert.ok(builds.some(([command, args]) => command === 'go' && args.join(' ') === '-C shell test ./...'));
  assert.ok(builds.some(([command, args]) => command === 'pnpm' && args.join(' ') === '--dir shell run build'));
  assert.ok(builds.every(([, args]) => !args.includes('-debug')));
  const releaseBuilds = buildCommands({ release: true });
  assert.ok(releaseBuilds.some(([command, args]) => command === 'pnpm' && args.join(' ') === '--dir shell run build'));
  assert.ok([...commands, ...builds].every(([, args]) => !args.join(' ').includes('prepare-resources')));
  assert.ok([...commands, ...builds].every(([, args]) => !args.join(' ').includes('cargo')));
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
  assert.equal(calls.at(-1)[0], 'pnpm');
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
  assert.deepEqual(calls[0], ['uv', ['sync', '--locked']]);
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
