import assert from 'node:assert/strict';
import test from 'node:test';

import { duration, render, timings } from './run-timings.mjs';

const run = { created_at: '2026-09-23T02:00:00Z', updated_at: '2026-09-23T02:20:00Z' };
const jobs = [
  {
    name: 'Windows build',
    labels: ['windows-latest'],
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-09-23T02:02:18Z',
    completed_at: '2026-09-23T02:08:26Z',
    steps: [{ name: 'Build native package', conclusion: 'success', started_at: '2026-09-23T02:03:00Z', completed_at: '2026-09-23T02:07:30Z' }],
  },
  { name: 'quality / js', labels: ['ubuntu-latest'], status: 'completed', conclusion: 'failure', started_at: '2026-09-23T02:00:03Z', completed_at: '2026-09-23T02:13:36Z', steps: [] },
  { name: 'Windows release', labels: [], status: 'completed', conclusion: 'skipped', started_at: null, completed_at: null },
];

test('duration reads as minutes and seconds', () => {
  assert.equal(duration(813), '13 m 33 s');
  assert.equal(duration(42), '42 s');
  assert.equal(duration(null), '-');
});

test('jobs are ordered by how long they queued, and the wall clock ends at the last finished job', () => {
  const result = timings(run, jobs);
  assert.equal(result.wallClock, 13 * 60 + 36);
  assert.deepEqual(
    result.rows.map((row) => [row.name, row.queuedFor, row.ran]),
    [
      ['quality / js', 3, 813],
      ['Windows build', 138, 368],
      ['Windows release', null, null],
    ],
  );
});

test('the table shows steps only when asked', () => {
  const plain = render(timings(run, jobs));
  assert.match(plain, /^Wall clock: 13 m 36 s$/m);
  assert.match(plain, /\| `Windows build` \| windows-latest \| 2 m 18 s \| 6 m 8 s \| success \|/);
  assert.doesNotMatch(plain, /Build native package/);
  assert.match(render(timings(run, jobs), { steps: true }), /Build native package \| \| \| 4 m 30 s \| success/);
});
