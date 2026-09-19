import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applyLabelPlan, planLabelSync, validateLabels } from './sync-labels.mjs';

const bug = { name: 'bug', color: 'd73a4a', description: 'Something is broken' };

test('planLabelSync creates labels the repository lacks', () => {
  const plan = planLabelSync([bug], []);
  assert.deepEqual(plan.create, [bug]);
  assert.deepEqual(plan.update, []);
});

test('planLabelSync leaves a matching label alone, ignoring colour case', () => {
  const plan = planLabelSync([bug], [{ name: 'bug', color: 'D73A4A', description: 'Something is broken' }]);
  assert.deepEqual(plan, { create: [], update: [], unmanaged: [] });
});

test('planLabelSync updates a drifted colour or description and treats a null description as empty', () => {
  const drifted = planLabelSync([bug], [{ name: 'bug', color: 'ffffff', description: 'Something is broken' }]);
  assert.equal(drifted.update.length, 1);
  assert.equal(drifted.update[0].current, 'bug');

  const bare = planLabelSync([{ name: 'wontfix', color: 'ffffff', description: '' }], [{ name: 'wontfix', color: 'ffffff', description: null }]);
  assert.deepEqual(bare.update, []);
});

test('planLabelSync fixes name casing without creating a duplicate', () => {
  const plan = planLabelSync([bug], [{ name: 'Bug', color: 'd73a4a', description: 'Something is broken' }]);
  assert.deepEqual(plan.create, []);
  assert.equal(plan.update[0].current, 'Bug');
});

test('planLabelSync reports labels the file does not manage but never deletes them', () => {
  const plan = planLabelSync([bug], [{ name: 'stray', color: '000000', description: '' }]);
  assert.deepEqual(plan.unmanaged, ['stray']);
});

test('validateLabels rejects malformed entries and case-insensitive duplicates', () => {
  assert.throws(() => validateLabels([{ name: '', color: 'ffffff', description: '' }]), /name/);
  assert.throws(() => validateLabels([{ name: 'a', color: '#ffffff', description: '' }]), /colour/);
  assert.throws(() => validateLabels([{ name: 'a', color: 'ffffff', description: 'x'.repeat(101) }]), /100/);
  assert.throws(() => validateLabels([{ name: 'a', color: 'ffffff' }]), /description/);
  assert.throws(() => validateLabels([bug, { ...bug, name: 'BUG' }]), /duplicate/i);
  assert.doesNotThrow(() => validateLabels([bug]));
});

test('applyLabelPlan sends one POST per create and one PATCH per update, URL-encoding the name', () => {
  const calls = [];
  const send = (method, endpoint, fields) => calls.push({ method, endpoint, fields });
  applyLabelPlan(
    { create: [{ name: 'area:ui', color: '1d76db', description: 'UI' }], update: [{ name: 'Bug', color: 'd73a4a', description: 'x', current: 'bug' }] },
    send,
  );
  assert.deepEqual(calls[0], { method: 'POST', endpoint: 'repos/{owner}/{repo}/labels', fields: { name: 'area:ui', color: '1d76db', description: 'UI' } });
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].endpoint, 'repos/{owner}/{repo}/labels/bug');
  assert.equal(calls[1].fields.new_name, 'Bug');
});

test('the committed .github/labels.json is valid and covers every area the labeler assigns', () => {
  const labels = JSON.parse(readFileSync(new URL('../../.github/labels.json', import.meta.url), 'utf8'));
  validateLabels(labels);
  const names = new Set(labels.map((label) => label.name));
  const labeler = readFileSync(new URL('../../.github/labeler.yml', import.meta.url), 'utf8');
  for (const [, area] of labeler.matchAll(/^(area:[\w-]+):/gm)) {
    assert.ok(names.has(area), `${area} is assigned by labeler.yml but missing from labels.json`);
  }
});
