import { describe, expect, it } from 'vitest';
import { paceLine, paceOf } from './productionPace';

const points = (from: string, hours: number[]) =>
  hours.map((hoursLogged, index) => ({ date: new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10), hoursLogged }));
const totals = (finalizedChapters: number, chapters = 12) => ({ chapters, finalizedChapters });

describe('paceOf', () => {
  it('is unknown, and says why, with no hours logged or no chapter finalized (never a guess)', () => {
    expect(paceOf({ points: [], totals: totals(4), deadline: null, today: '2026-09-29' })).toEqual({ kind: 'unknown', reason: 'no hours logged yet' });
    expect(paceOf({ points: points('2026-09-20', [1, 2]), totals: totals(0), deadline: null, today: '2026-09-29' })).toEqual({
      kind: 'unknown',
      reason: 'no chapter finalized yet',
    });
    expect(paceOf({ points: null, totals: totals(4), deadline: null, today: '2026-09-29' })).toEqual({
      kind: 'unknown',
      reason: 'the hours could not be read',
    });
  });

  it('is done once every chapter is finalized', () => {
    expect(paceOf({ points: points('2026-09-20', [1]), totals: totals(12), deadline: null, today: '2026-09-29' })).toEqual({ kind: 'done' });
  });

  it('projects the finish from chapters finalized per day since the first logged day, against the delivery date', () => {
    // 4 finalized over 10 days (Sep 20 to Sep 29 inclusive) = 0.4 a day; 8 left = 20 days: Oct 19.
    const onPace = paceOf({ points: points('2026-09-20', [1]), totals: totals(4), deadline: { date: '2026-10-25', daysLeft: 26 }, today: '2026-09-29' });
    expect(onPace).toEqual({ kind: 'projected', finishDate: '2026-10-19', daysLate: -6 });
    const late = paceOf({ points: points('2026-09-20', [1]), totals: totals(4), deadline: { date: '2026-10-14', daysLeft: 15 }, today: '2026-09-29' });
    expect(late).toEqual({ kind: 'projected', finishDate: '2026-10-19', daysLate: 5 });
  });

  it('has no verdict without a delivery date', () => {
    expect(paceOf({ points: points('2026-09-20', [1]), totals: totals(4), deadline: null, today: '2026-09-29' })).toEqual({
      kind: 'projected',
      finishDate: '2026-10-19',
      daysLate: null,
    });
  });
});

describe('paceLine', () => {
  it('words each state for the pill', () => {
    expect(paceLine({ kind: 'done' })).toEqual({ tone: 'success', label: 'All chapters finalized' });
    expect(paceLine({ kind: 'unknown', reason: 'no chapter finalized yet' })).toEqual({ tone: 'neutral', label: 'Pace unknown · no chapter finalized yet' });
    expect(paceLine({ kind: 'projected', finishDate: '2026-10-09', daysLate: -5 })).toEqual({
      tone: 'success',
      label: 'On track · at current pace done Oct 9',
    });
    expect(paceLine({ kind: 'projected', finishDate: '2026-10-09', daysLate: 0 }).tone).toBe('success');
    expect(paceLine({ kind: 'projected', finishDate: '2026-10-19', daysLate: 5 })).toEqual({
      tone: 'warning',
      label: 'Behind · at current pace done Oct 19 (5 days late)',
    });
    expect(paceLine({ kind: 'projected', finishDate: '2026-11-19', daysLate: 1 })).toMatchObject({
      label: 'Behind · at current pace done Nov 19 (1 day late)',
    });
    expect(paceLine({ kind: 'projected', finishDate: '2026-11-19', daysLate: 20 }).tone).toBe('danger');
    expect(paceLine({ kind: 'projected', finishDate: '2026-10-09', daysLate: null })).toEqual({ tone: 'info', label: 'At current pace done Oct 9' });
  });
});
