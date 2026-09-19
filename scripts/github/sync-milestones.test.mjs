import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applyMilestonePlan, desiredMilestones, planMilestoneSync } from './sync-milestones.mjs';

const roadmap = {
  milestones: [
    { number: 1, title: 'Dashboard foundation', summary: 'Findings and review.' },
    { number: 2, title: 'Recording and take review', summary: 'Takes.' },
  ],
};

test('desiredMilestones numbers each title and uses the summary as the description', () => {
  assert.deepEqual(desiredMilestones(roadmap), [
    { order: 1, title: '1. Dashboard foundation', description: 'Findings and review.' },
    { order: 2, title: '2. Recording and take review', description: 'Takes.' },
  ]);
});

test('desiredMilestones rejects duplicate numbers and missing text', () => {
  assert.throws(() => desiredMilestones({ milestones: [roadmap.milestones[0], roadmap.milestones[0]] }), /duplicate/i);
  assert.throws(() => desiredMilestones({ milestones: [{ number: 1, title: '', summary: 'x' }] }), /title/);
  assert.throws(() => desiredMilestones({ milestones: [{ number: 1, title: 'x', summary: '' }] }), /summary/);
  assert.throws(() => desiredMilestones({ milestones: [{ number: 'one', title: 'x', summary: 'y' }] }), /number/);
  assert.throws(() => desiredMilestones({}), /milestones/);
});

test('planMilestoneSync creates milestones that do not exist', () => {
  const plan = planMilestoneSync(desiredMilestones(roadmap), []);
  assert.equal(plan.create.length, 2);
  assert.deepEqual(plan.update, []);
});

test('planMilestoneSync is a no-op when titles and descriptions match, even if closed', () => {
  const existing = [
    { number: 7, title: '1. Dashboard foundation', description: 'Findings and review.', state: 'closed' },
    { number: 8, title: '2. Recording and take review', description: 'Takes.', state: 'open' },
  ];
  assert.deepEqual(planMilestoneSync(desiredMilestones(roadmap), existing), { create: [], update: [], unmanaged: [] });
});

test('planMilestoneSync matches by the leading number, so a retitled roadmap entry updates instead of duplicating', () => {
  const existing = [{ number: 7, title: '1. Old name', description: null, state: 'open' }];
  const plan = planMilestoneSync(desiredMilestones(roadmap), existing);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0].order, 2);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].githubNumber, 7);
  assert.equal(plan.update[0].title, '1. Dashboard foundation');
});

test('planMilestoneSync reports milestones it does not manage and never plans to remove them', () => {
  const existing = [{ number: 3, title: 'Release 1.0 blockers', description: '', state: 'open' }];
  assert.deepEqual(planMilestoneSync(desiredMilestones(roadmap), existing).unmanaged, ['Release 1.0 blockers']);
});

test('applyMilestonePlan POSTs new milestones open and PATCHes drifted ones by GitHub number', () => {
  const calls = [];
  const send = (method, endpoint, fields) => calls.push({ method, endpoint, fields });
  applyMilestonePlan(
    { create: [{ order: 2, title: '2. B', description: 'b' }], update: [{ githubNumber: 7, order: 1, title: '1. A', description: 'a' }] },
    send,
  );
  assert.deepEqual(calls[0], { method: 'POST', endpoint: 'repos/{owner}/{repo}/milestones', fields: { title: '2. B', description: 'b', state: 'open' } });
  assert.deepEqual(calls[1], { method: 'PATCH', endpoint: 'repos/{owner}/{repo}/milestones/7', fields: { title: '1. A', description: 'a' } });
});

test('the committed roadmap.json yields valid milestones', () => {
  const roadmapFile = JSON.parse(readFileSync(new URL('../../shared/config/roadmap.json', import.meta.url), 'utf8'));
  assert.ok(desiredMilestones(roadmapFile).length >= 1);
});
