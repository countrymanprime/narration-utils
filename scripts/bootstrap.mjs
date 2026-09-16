#!/usr/bin/env node

/**
 * Portable checkout bootstrapper. Release packaging intentionally lives in
 * scripts/release/ and is never invoked here.
 */
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

export const NODE_MAJOR = 22;
export const PYTHON_VERSION = '3.12';
export const STYLUA_VERSION = '2.1.0';

export function parseOptions(argv) {
  const options = { python: undefined, skipInstall: false, refresh: false, release: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--python') {
      options.python = argv[++index];
      if (!options.python) throw new Error('--python requires an executable path.');
    } else if (argument === '--skip-install') {
      options.skipInstall = true;
    } else if (argument === '--refresh') {
      options.refresh = true;
    } else if (argument === '--release') {
      options.release = true;
    } else if (argument === '--help' || argument === '-h') {
      return { ...options, help: true };
    } else {
      throw new Error(`Unknown bootstrap option: ${argument}`);
    }
  }
  if (options.skipInstall && options.refresh) {
    throw new Error('--skip-install and --refresh cannot be used together.');
  }
  return options;
}

export function localPython(root, platform = process.platform) {
  const separator = platform === 'win32' ? '\\' : '/';
  return [root.replace(/[\\/]+$/, ''), '.venv', platform === 'win32' ? 'Scripts' : 'bin', platform === 'win32' ? 'python.exe' : 'python'].join(separator);
}

export function localPaths(root, platform = process.platform) {
  const separator = platform === 'win32' ? '\\' : '/';
  const path = (...parts) => [root.replace(/[\\/]+$/, ''), ...parts].join(separator);
  return [localPython(root, platform), path('node_modules'), path('shared', 'ui', 'node_modules'), path('shell', 'node_modules')];
}

export function bootstrapCommands(root, python, platform = process.platform, pythonPrefix = []) {
  const venvPython = localPython(root, platform);
  return [
    [python, [...pythonPrefix, '-m', 'venv', '.venv']],
    [venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', 'requirements.lock']],
    ['npm', ['ci']],
    ['npm', ['--prefix', 'shared/ui', 'ci']],
    ['npm', ['--prefix', 'shell', 'ci']],
    ['cargo', ['install', 'stylua', '--version', STYLUA_VERSION, '--locked']],
  ];
}

export function buildCommands({ release = false } = {}) {
  return [
    ['npm', ['--prefix', 'shared/ui', 'run', 'build']],
    ['cargo', ['build', '--workspace', ...(release ? ['--release'] : [])]],
  ];
}

function commandName(command, platform) {
  if (platform !== 'win32') return command;
  if (command === 'npm') return 'npm.cmd';
  if (command === 'cargo' || command === 'stylua') {
    const cargoBinary = join(process.env.USERPROFILE ?? '', '.cargo', 'bin', `${command}.exe`);
    if (existsSync(cargoBinary)) return cargoBinary;
  }
  return /[\\/]|\.exe$/i.test(command) ? command : `${command}.exe`;
}

function run(command, args, { root, platform, capture = false }) {
  const result = spawnSync(commandName(command, platform), args, {
    cwd: root,
    encoding: 'utf8',
    // npm.cmd is a batch file on Windows. Every other command bypasses the
    // shell so Python arguments retain their argv.
    shell: platform === 'win32' && command === 'npm',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw new Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr ?? ''}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.${detail}`);
  }
  return result.stdout?.trim() ?? '';
}

function requireVersion(command, args, pattern, expected, context) {
  const output = run(command, args, contextWithCapture(context));
  const match = output.match(pattern);
  if (!match || match[1] !== expected) {
    throw new Error(`${command} must be version ${expected}; found ${output || 'no version output'}.`);
  }
}

function contextWithCapture(context) {
  return { ...context, capture: true };
}

function verifyToolchain(context) {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor !== NODE_MAJOR) {
    throw new Error(`Node.js ${NODE_MAJOR} is required; found ${process.versions.node}.`);
  }
  run('npm', ['--version'], contextWithCapture(context));
  run('cargo', ['--version'], contextWithCapture(context));
}

export function pythonVersionError(error) {
  return `Python ${PYTHON_VERSION} is required. ${error.message} Install Python ${PYTHON_VERSION} or rerun with --python <path-to-python-${PYTHON_VERSION}>.`;
}

function verifyPython(python, pythonPrefix, context) {
  try {
    requireVersion(
      python,
      [...pythonPrefix, '-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'],
      /^(\d+\.\d+)$/,
      PYTHON_VERSION,
      context,
    );
  } catch (error) {
    throw new Error(pythonVersionError(error));
  }
}

function defaultPython(platform, context) {
  if (platform !== 'win32') return { command: 'python3', prefix: [] };
  try {
    verifyPython('py', ['-3.12'], context);
    return { command: 'py', prefix: ['-3.12'] };
  } catch {
    verifyPython('python', [], context);
    return { command: 'python', prefix: [] };
  }
}

function clearLocalInstalls(root, platform) {
  for (const path of [...localPaths(root, platform).slice(1), join(root, '.venv')]) {
    const target = resolve(path);
    if (!target.startsWith(`${resolve(root)}${platform === 'win32' ? '\\' : '/'}`)) {
      throw new Error(`Refusing to remove a path outside this checkout: ${target}`);
    }
    rmSync(target, { recursive: true, force: true });
  }
}

function helpText() {
  return `Usage: npm run bootstrap -- [--python <path>] [--skip-install] [--refresh] [--release]

Creates a portable checkout environment and builds the UI and debug workspace binary.
It never builds installers or downloads optional spaCy models or Piper voices.
--skip-install requires existing local environments. --refresh recreates them from lockfiles.
--release builds the workspace binary with Cargo's release profile.`;
}

export function runBootstrap(options, dependencies = {}) {
  const root = dependencies.root ?? process.cwd();
  const platform = dependencies.platform ?? process.platform;
  const runner = dependencies.run ?? run;
  const exists = dependencies.exists ?? existsSync;
  let python = options.python;
  let pythonPrefix = [];
  const context = { root, platform };

  if (options.help) {
    (dependencies.log ?? console.log)(helpText());
    return;
  }

  if (options.refresh) clearLocalInstalls(root, platform);
  if (options.skipInstall) {
    const missing = localPaths(root, platform).filter((path) => !exists(path));
    if (missing.length) throw new Error(`--skip-install requires existing local paths:\n${missing.join('\n')}`);
  } else {
    // The real runner is used for preflight; tests can provide a command runner
    // and exercise the resulting setup sequence without installing anything.
    if (dependencies.skipPreflight !== true) {
      verifyToolchain(context);
      if (python) {
        verifyPython(python, pythonPrefix, context);
      } else {
        ({ command: python, prefix: pythonPrefix } = defaultPython(platform, context));
      }
    } else if (!python) {
      python = platform === 'win32' ? 'py' : 'python3';
      pythonPrefix = platform === 'win32' ? ['-3.12'] : [];
    }
    const commands = bootstrapCommands(root, python, platform, pythonPrefix);
    const installCommands = exists(localPython(root, platform)) ? commands.slice(1) : commands;
    for (const [command, args] of installCommands) {
      runner(command, args, context);
    }
  }
  if (options.skipInstall && dependencies.skipPreflight !== true) {
    verifyToolchain(context);
    verifyPython(localPython(root, platform), [], context);
  }
  for (const [command, args] of buildCommands({ release: options.release })) {
    runner(command, args, context);
  }

  (dependencies.log ?? console.log)(
    'Narration Utils is ready. Optional spaCy models and Piper voices were not downloaded. Story Bible uses rules-only extraction until a selected spaCy model is installed through its first-use flow.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    runBootstrap(parseOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(`Bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  }
}
