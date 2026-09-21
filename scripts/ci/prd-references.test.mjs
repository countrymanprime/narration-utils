import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { REPO_ROOT, readTrackedText, trackedFiles } from './layout.mjs';
import { findMissingPrdReferences, isSourceFile } from './prd-references.mjs';

test('findMissingPrdReferences reports a cited PRD that no longer exists, with file and line', () => {
  const files = new Map([
    ['apps/desktop/app.go', 'package main\n// see docs/prds/gone.prd.md for the plan\n'],
    ['sidecars/x/core.py', '# docs/prds/kept.prd.md is still here\n'],
  ]);

  const missing = findMissingPrdReferences(files, (path) => path === 'docs/prds/kept.prd.md');

  assert.deepEqual(missing, [{ file: 'apps/desktop/app.go', line: 2, reference: 'docs/prds/gone.prd.md' }]);
});

test('findMissingPrdReferences reads the plan and the README of the folder too', () => {
  const files = new Map([['scripts/x.mjs', "// docs/prds/implementation-plan.md and docs/prds/README.md\n"]]);

  const missing = findMissingPrdReferences(files, () => false);

  assert.deepEqual(
    missing.map((entry) => entry.reference),
    ['docs/prds/implementation-plan.md', 'docs/prds/README.md'],
  );
});

test('findMissingPrdReferences ignores a path that only looks like a PRD', () => {
  const files = new Map([['a.go', '// docs/prds/ and docs/prds/*.prd.md and other/docs/prds/x.txt\n']]);

  assert.deepEqual(findMissingPrdReferences(files, () => false), []);
});

test('isSourceFile leaves Markdown, the ADRs and the fixtures that name made-up PRDs to other checks', () => {
  assert.equal(isSourceFile('apps/desktop/app.go'), true);
  assert.equal(isSourceFile('.github/dependabot.yml'), true);
  assert.equal(isSourceFile('docs/architecture/x.md'), false);
  assert.equal(isSourceFile('tools/docs-site/tests/test_hooks.py'), false);
  assert.equal(isSourceFile('docs/prds/other.prd.md'), false);
});

test('every PRD a source file cites exists (ADR 0028: a deleted PRD takes its citations with it)', () => {
  const sources = new Map([...readTrackedText(trackedFiles().filter(isSourceFile))]);

  const missing = findMissingPrdReferences(sources, (path) => existsSync(join(REPO_ROOT, path)));

  assert.deepEqual(missing, [], `Source files cite PRDs that do not exist (delete the citation or point it at the steady-state doc):\n${missing.map((m) => `  ${m.file}:${m.line} ${m.reference}`).join('\n')}`);
});
