import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyFiles } from './changed-files.mjs';

test('documentation-only changes skip bootstrap and native packages', () => {
  assert.deepEqual(classifyFiles(['README.md', 'docs/operations/ci-and-releases.md']), { bootstrap: false, package: false });
});

test('bootstrap inputs run the bootstrap matrix and retain package coverage', () => {
  assert.deepEqual(classifyFiles(['scripts/bootstrap.mjs']), { bootstrap: true, package: true });
  assert.deepEqual(classifyFiles(['uv.lock']), { bootstrap: true, package: true });
  assert.deepEqual(classifyFiles(['pnpm-lock.yaml']), { bootstrap: true, package: true });
});

test('runtime and unknown paths retain native package coverage', () => {
  assert.deepEqual(classifyFiles(['apps/desktop/app.go']), { bootstrap: false, package: true });
  assert.deepEqual(classifyFiles(['new-runtime-area/config.json']), { bootstrap: false, package: true });
});

test('scheduled and manually dispatched CI are exhaustive', () => {
  assert.deepEqual(classifyFiles([], { exhaustive: true }), { bootstrap: true, package: true });
});
