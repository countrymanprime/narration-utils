import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { audit, sync } from '../plugin/cli/ui-atlas.mjs';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'shared', 'ui');

test('shared/ui is the upstream of the kit core files and has not drifted', () => {
  const { drift } = sync(UI, { check: true });
  assert.deepEqual(drift, [], `run: node tools/ui-atlas-kit/scripts/refresh-core.mjs (drifted: ${drift.join(', ')})`);
});

test('this repo passes its own audit with every primitive covered', () => {
  const result = audit(UI);
  assert.deepEqual(result.counts.uncovered, []);
  assert.equal(result.tier, 2);
  assert.ok(result.score >= 80, `score ${result.score}: ${result.gaps.join('; ')}`);
});
