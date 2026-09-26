// Bumps hostAPIVersion in the three places that must agree, then regenerates the Wails bindings (Host.*).
//
// The version is `const hostAPIVersion` in apps/desktop/app.go, the check (and its message) in apps/desktop/app_test.go, and
// DESKTOP_HOST_API_VERSION in apps/ui/src/hostApi.ts. The agent train's rule (docs/operations/agent-train.md, "Serial points"):
// a PR that adds a binding takes main's value + 1, and on a collision whoever merges main second takes the higher value + 1.
// So the new version is the highest one seen (in the three files, and at --against <ref> when given) plus one.
//
//   node scripts/dev/bump-host-api.mjs --against origin/main   bump past main and the files, then regenerate Host.*
//   node scripts/dev/bump-host-api.mjs --dry-run               say what it would do, change nothing
//   node scripts/dev/bump-host-api.mjs --to 70 --no-bindings   set an exact version, skip the regeneration
//
// Tested by scripts/ci/bump-host-api.test.mjs (repo-scripts:test-node).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

export const FILES = {
  app: 'apps/desktop/app.go',
  test: 'apps/desktop/app_test.go',
  ui: 'apps/ui/src/hostApi.ts',
};

/** `pnpm --dir apps/desktop run bindings`: `wails3 generate bindings` into apps/ui/wailsjs, which is Host.*. */
export const BINDINGS_COMMAND = ['pnpm', ['--dir', 'apps/desktop', 'run', 'bindings']];

// Each pattern captures the version; every one must match exactly once in its file.
const PATTERNS = {
  app: [{ label: '`const hostAPIVersion = N`', pattern: /^(const hostAPIVersion = )(\d+)()$/gm }],
  test: [
    { label: '`if hostAPIVersion != N {`', pattern: /^(\tif hostAPIVersion != )(\d+)( \{)$/gm },
    { label: '`want N;`', pattern: /(host API version = %d, want )(\d+)(;)/g },
  ],
  ui: [{ label: '`export const DESKTOP_HOST_API_VERSION = N;`', pattern: /^(export const DESKTOP_HOST_API_VERSION = )(\d+)(;)$/gm }],
};

function versionsIn(key, text) {
  return PATTERNS[key].map(({ label, pattern }) => {
    const matches = [...text.matchAll(pattern)];
    if (matches.length !== 1) throw new Error(`${FILES[key]}: expected one ${label}, found ${matches.length}`);
    return Number(matches[0][2]);
  });
}

/** The version each file holds. Throws when a file's line is missing or repeated, or app_test.go disagrees with itself. */
export function readVersions(texts) {
  const [app] = versionsIn('app', texts.app);
  const [check, message] = versionsIn('test', texts.test);
  if (check !== message) throw new Error(`${FILES.test} checks ${check} but its message says ${message}`);
  const [ui] = versionsIn('ui', texts.ui);
  return { app, test: check, ui };
}

/** The highest version seen, plus one. */
export function nextVersion(versions, base) {
  return Math.max(...Object.values(versions), ...(base === undefined ? [] : [base])) + 1;
}

/** The three files with their version set to `to`, and nothing else changed. */
export function bumpTexts(texts, to) {
  const set = (key) => PATTERNS[key].reduce((text, { pattern }) => text.replace(pattern, (_match, head, _old, tail = '') => `${head}${to}${tail}`), texts[key]);
  return { app: set('app'), test: set('test'), ui: set('ui') };
}

export function parseArgs(argv) {
  const options = { dryRun: false, bindings: true, to: undefined, against: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-bindings') options.bindings = false;
    else if (arg === '--to') {
      const value = argv[++index];
      if (!/^\d+$/.test(value ?? '')) throw new Error('--to needs a whole number');
      options.to = Number(value);
    } else if (arg === '--against') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--against needs a git ref, for example origin/main');
      options.against = value;
    } else throw new Error(`unknown option ${arg} (use --dry-run, --no-bindings, --to N, --against <ref>)`);
  }
  return options;
}

function versionAt(ref) {
  const shown = spawnSync('git', ['show', `${ref}:${FILES.app}`], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (shown.status !== 0) throw new Error(`could not read ${FILES.app} at ${ref}: ${shown.stderr.trim()}`);
  return versionsIn('app', shown.stdout)[0];
}

function main(argv) {
  const options = parseArgs(argv);
  const texts = Object.fromEntries(Object.entries(FILES).map(([key, path]) => [key, readFileSync(join(REPO_ROOT, path), 'utf8')]));
  const versions = readVersions(texts);
  const base = options.against === undefined ? undefined : versionAt(options.against);
  const highest = Math.max(...Object.values(versions), ...(base === undefined ? [] : [base]));
  const to = options.to ?? nextVersion(versions, base);
  if (to <= highest) throw new Error(`--to ${to} would not raise the version: the highest seen is ${highest}`);

  const seen = `app.go ${versions.app}, app_test.go ${versions.test}, hostApi.ts ${versions.ui}${base === undefined ? '' : `, ${options.against} ${base}`}`;
  const [command, args] = BINDINGS_COMMAND;
  console.log(`hostAPIVersion -> ${to} (seen: ${seen})`);
  if (options.dryRun) {
    for (const path of Object.values(FILES)) console.log(`would write ${path}`);
    console.log(options.bindings ? `would run: ${command} ${args.join(' ')}` : 'would skip the bindings (--no-bindings)');
    return;
  }

  const bumped = bumpTexts(texts, to);
  for (const [key, path] of Object.entries(FILES)) writeFileSync(join(REPO_ROOT, path), bumped[key]);
  console.log(`wrote ${Object.values(FILES).join(', ')}`);
  if (!options.bindings) return;
  console.log(`running: ${command} ${args.join(' ')}`);
  const run = spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (run.status !== 0) {
    throw new Error(
      `the bindings did not regenerate (exit ${run.status ?? run.error?.message}); the three files are bumped, so fix wails3 and run: ${command} ${args.join(' ')}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`bump-host-api: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
