import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { BINDINGS_COMMAND, FILES, bumpTexts, nextVersion, parseArgs, readVersions } from '../dev/bump-host-api.mjs';
import { REPO_ROOT } from './layout.mjs';

const texts = (version, uiVersion = version) => ({
  app: `package main\n\n// comment\nconst hostAPIVersion = ${version}\n\nfunc x() any { return hostAPIVersion }\n`,
  test: `func TestHostAPIVersionMatchesTheCurrentDesktopContract(t *testing.T) {\n\tif hostAPIVersion != ${version} {\n\t\tt.Fatalf("host API version = %d, want ${version}; update it with apps/ui/src/hostApi.ts", hostAPIVersion)\n\t}\n}\n`,
  ui: `// The host API version this UI speaks.\nexport const DESKTOP_HOST_API_VERSION = ${uiVersion};\n`,
});

test('readVersions reads the version out of each of the three files', () => {
  assert.deepEqual(readVersions(texts(61)), { app: 61, test: 61, ui: 61 });
  assert.deepEqual(readVersions(texts(61, 62)), { app: 61, test: 61, ui: 62 });
});

test('readVersions refuses a file whose version line is missing, or appears twice', () => {
  assert.throws(() => readVersions({ ...texts(61), app: 'package main\n' }), /apps\/desktop\/app\.go: expected one `const hostAPIVersion = N`, found 0/);
  const twice = texts(61);
  assert.throws(() => readVersions({ ...twice, ui: twice.ui + twice.ui }), /apps\/ui\/src\/hostApi\.ts: expected one .*found 2/);
  assert.throws(() => readVersions({ ...texts(61), test: '\tif hostAPIVersion != 61 {\n' }), /app_test\.go: expected one `want N;`/);
});

test('readVersions refuses an app_test.go whose check and message disagree', () => {
  const bad = texts(61);
  bad.test = bad.test.replace('want 61;', 'want 60;');
  assert.throws(() => readVersions(bad), /app_test\.go checks 61 but its message says 60/);
});

test('nextVersion is the highest version seen plus one: after a merge, the higher side wins and moves on', () => {
  assert.equal(nextVersion({ app: 61, test: 61, ui: 61 }), 62);
  assert.equal(nextVersion({ app: 62, test: 62, ui: 61 }), 63);
  assert.equal(nextVersion({ app: 61, test: 61, ui: 61 }, 64), 65);
});

test('bumpTexts changes the three versions and nothing else', () => {
  const before = texts(61);
  const after = bumpTexts(before, 62);

  assert.deepEqual(after, texts(62));
  assert.deepEqual(readVersions(after), { app: 62, test: 62, ui: 62 });
});

test('parseArgs reads the options and refuses what it does not know', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, bindings: true, to: undefined, against: undefined });
  assert.deepEqual(parseArgs(['--dry-run', '--no-bindings', '--to', '70', '--against', 'origin/main']), {
    dryRun: true,
    bindings: false,
    to: 70,
    against: 'origin/main',
  });
  assert.throws(() => parseArgs(['--to', 'x']), /--to needs a whole number/);
  assert.throws(() => parseArgs(['--against']), /--against needs a git ref/);
  assert.throws(() => parseArgs(['--bump']), /unknown option --bump/);
});

test('the three files in the tree agree and parse, so the script can bump them', () => {
  const tree = Object.fromEntries(Object.entries(FILES).map(([key, path]) => [key, readFileSync(join(REPO_ROOT, path), 'utf8')]));
  const versions = readVersions(tree);

  assert.equal(new Set(Object.values(versions)).size, 1, `the host API version differs between the files: ${JSON.stringify(versions)}`);
  assert.deepEqual(readVersions(bumpTexts(tree, versions.app + 1)), { app: versions.app + 1, test: versions.app + 1, ui: versions.app + 1 });
});

test('the bindings command is the desktop project’s own bindings script', () => {
  const desktop = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/desktop/package.json'), 'utf8'));

  assert.ok(desktop.scripts.bindings, 'apps/desktop/package.json has no bindings script');
  assert.deepEqual(BINDINGS_COMMAND, ['pnpm', ['--dir', 'apps/desktop', 'run', 'bindings']]);
});
