import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPathMap, findStaleReferences, loadLayout, readTrackedText, trackedFiles, unexpectedRoots } from './layout.mjs';

const renames = [
  { from: 'shared/ui', to: 'apps/ui' },
  { from: 'shell/', to: 'apps/desktop/' },
  { from: 'tools/manuscript-guide/core/tests', to: 'sidecars/manuscript-guide/tests' },
  { from: 'tools/manuscript-guide', to: 'sidecars/manuscript-guide' },
];

test('applyPathMap rewrites repo paths wherever they appear in a line', () => {
  assert.equal(applyPathMap('see shared/ui/src/App.tsx', renames), 'see apps/ui/src/App.tsx');
  assert.equal(applyPathMap('`shared/ui`, `shell/app.go`', renames), '`apps/ui`, `apps/desktop/app.go`');
  assert.equal(applyPathMap('frontend:dir ../shared/ui', renames), 'frontend:dir ../apps/ui');
  assert.equal(applyPathMap('directory: /shared/ui', renames), 'directory: /apps/ui');
});

test('applyPathMap prefers the most specific rename', () => {
  assert.equal(applyPathMap('tools/manuscript-guide/core/tests/test_x.py', renames), 'sidecars/manuscript-guide/tests/test_x.py');
  assert.equal(applyPathMap('tools/manuscript-guide/core/x.py', renames), 'sidecars/manuscript-guide/core/x.py');
});

test('applyPathMap leaves look-alikes, prose and the Go module path alone', () => {
  const untouched = [
    'reshared/ui and shared/uikit',
    'the shell is a Go program',
    'github.com/countrymanprime/narration-utils/shell/internal/bridge',
    'tools/ui-atlas-kit/README.md',
    'narration-utils-shell',
  ];
  for (const line of untouched) assert.equal(applyPathMap(line, renames), line);
});

test('findStaleReferences reports each retired path with its file and line', () => {
  const files = new Map([
    ['README.md', 'first line\nsee shared/ui here\n'],
    ['docs/adr/0001-x.md', 'shared/ui in an accepted ADR'],
    ['clean.md', 'nothing to see'],
  ]);

  const stale = findStaleReferences(files, renames, ['docs/adr/']);

  assert.deepEqual(stale, [{ file: 'README.md', line: 2, text: 'see shared/ui here' }]);
});

test('unexpectedRoots lists tracked top-level entries outside the allowlist', () => {
  const tracked = ['README.md', 'docs/a.md', 'apps/ui/x.ts', 'stray/file.txt', 'LICENSE'];

  assert.deepEqual(unexpectedRoots(tracked, ['README.md', 'docs', 'apps', 'LICENSE']), ['stray']);
});

test('the shipped path map is idempotent, so re-running it on migrated text changes nothing', () => {
  const { renames } = loadLayout();

  for (const { from, to } of renames) {
    assert.notEqual(from, to);
    assert.equal(applyPathMap(to, renames), to, `${to} must not itself match a retired path`);
  }
});

test('the repository matches its layout contract', () => {
  const layout = loadLayout();
  const tracked = trackedFiles();

  assert.deepEqual(unexpectedRoots(tracked, layout.roots), [], 'a top-level entry is not in scripts/ci/layout.json roots; add it there only with a reason');
  if (!layout.enforceRetired) return;
  const stale = findStaleReferences(readTrackedText(tracked), layout.renames, layout.historical);
  assert.deepEqual(stale, [], 'tracked files still name a retired path; run node scripts/ci/apply-path-map.mjs');
});
