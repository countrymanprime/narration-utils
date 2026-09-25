import assert from 'node:assert/strict';
import test from 'node:test';

import { gateParallelism, workspaceWideChanges, workspaceWidePattern } from './local-gate.mjs';

test('the local gate runs half the CPUs side by side', () => {
  assert.equal(gateParallelism({ env: {}, cpus: 16 }), 8);
  assert.equal(gateParallelism({ env: {}, cpus: 3 }), 1);
  assert.equal(gateParallelism({ env: {}, cpus: 1 }), 1);
});

test('CI runs one task at a time, and NX_PARALLEL overrides both', () => {
  assert.equal(gateParallelism({ env: { CI: 'true' }, cpus: 16 }), 1);
  assert.equal(gateParallelism({ env: { CI: 'true', NX_PARALLEL: '3' }, cpus: 16 }), 3);
  assert.equal(gateParallelism({ env: { NX_PARALLEL: '1' }, cpus: 16 }), 1);
  assert.equal(gateParallelism({ env: { NX_PARALLEL: 'lots' }, cpus: 16 }), 8);
});

test('the workspace-wide pattern is the one CI reads from scripts/ci/nx-scope.sh', () => {
  const pattern = workspaceWidePattern();
  for (const file of ['pnpm-lock.yaml', 'uv.lock', 'scripts/quality.mjs', 'scripts/ci/coverage-floors.json', '.github/workflows/ci.yml']) {
    assert.ok(pattern.test(file), file);
  }
  for (const file of ['apps/ui/package.json', 'apps/ui/src/App.tsx', 'scripts/ci/layout.mjs', 'docs/operations/ci-and-releases.md']) {
    assert.ok(!pattern.test(file), file);
  }
});

test('a script without the pattern fails loudly rather than scoping nothing', () => {
  assert.throws(() => workspaceWidePattern('#!/usr/bin/env bash\necho all\n'), /no workspace_wide pattern/);
});

test('workspaceWideChanges picks the changed files that run everything', () => {
  assert.deepEqual(workspaceWideChanges(['apps/ui/src/App.tsx', 'uv.lock', 'nx.json']), ['uv.lock', 'nx.json']);
  assert.deepEqual(workspaceWideChanges(['libs/python/narration_common/x.py']), []);
});
