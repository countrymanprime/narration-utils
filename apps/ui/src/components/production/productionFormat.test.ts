import { describe, expect, it } from 'vitest';
import type { ProductionChapter } from '../../api/contracts/production';
import {
  boardCell,
  BOARD_COLUMNS,
  creditsCell,
  deadlineFigure,
  deliveryDue,
  formatClock,
  formatLength,
  formatPfh,
  formatRate,
  isCurrentStage,
  nextUpLine,
  stageHoursHint,
} from './productionFormat';

const chapter = (overrides: Partial<ProductionChapter>): ProductionChapter => ({
  id: 'chapter-1',
  title: 'Chapter 1',
  contentKind: 'narration',
  status: 'editing',
  wordCount: 400,
  recordedSeconds: null,
  hoursLogged: 0,
  pfh: null,
  readiness: null,
  ...overrides,
});

const column = (name: string) => {
  const found = BOARD_COLUMNS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no ${name} column`);
  return found;
};

describe('production figures', () => {
  it('writes hours and seconds as h:mm, rounding to the minute', () => {
    expect(formatClock(11 + 20 / 60, 'hours')).toBe('11:20');
    expect(formatClock(0.999, 'hours')).toBe('1:00');
    expect(formatClock(6720, 'seconds')).toBe('1:52');
    expect(formatClock(0, 'seconds')).toBe('0:00');
    expect(formatLength(708.4)).toBe('11:48');
  });

  it('shows an undefined PFH or rate as a dash, never 0 (ADR 0320)', () => {
    expect(formatPfh(null)).toBe('—');
    expect(formatPfh(6.123)).toBe('6.1');
    expect(formatRate(null)).toBe('—');
    expect(formatRate(1066.67)).toBe('1,067');
    expect(formatRate(0)).toBe('0');
  });

  it('names the logged hours by stage in pipeline order, leaving out a stage with none', () => {
    expect(stageHoursHint({ proofing: 1.75, recording: 5 + 40 / 60 })).toBe('record 5:40 · proof 1:45');
    expect(stageHoursHint({})).toBe('');
  });

  it('says how the deadline stands without projecting a pace', () => {
    expect(deadlineFigure(null, 3)).toMatchObject({ value: '—', tone: 'neutral' });
    expect(deadlineFigure({ date: '2026-10-14', daysLeft: 18 }, 3)).toMatchObject({ value: '18 days', tone: 'neutral' });
    expect(deadlineFigure({ date: '2026-09-30', daysLeft: 3 }, 3)).toMatchObject({ value: '3 days', tone: 'warning' });
    expect(deadlineFigure({ date: '2026-09-27', daysLeft: 1 }, 3)).toMatchObject({ value: '1 day', tone: 'warning' });
    expect(deadlineFigure({ date: '2026-09-26', daysLeft: 0 }, 3)).toMatchObject({ value: 'Today', tone: 'warning' });
    expect(deadlineFigure({ date: '2026-09-20', daysLeft: -2 }, 3)).toMatchObject({ value: '2 days over', tone: 'danger' });
    // Nothing left to finish: a near deadline is no warning.
    expect(deadlineFigure({ date: '2026-09-30', daysLeft: 3 }, 0)).toMatchObject({ tone: 'success' });
  });
});

describe('the board', () => {
  it("marks the stages a chapter has passed as done and the ones ahead as not yet, as the mock's compact glyphs (PR10)", () => {
    const proofing = chapter({ status: 'proofing' });
    expect(boardCell(proofing, column('Record'))).toEqual({ tone: 'success', label: '✓' });
    expect(boardCell(proofing, column('Edit'))).toEqual({ tone: 'success', label: '✓' });
    const recording = chapter({ status: 'recording' });
    expect(boardCell(recording, column('Proof'))).toEqual({ tone: 'neutral', label: '—' });
    expect(boardCell(chapter({ status: 'finalized' }), column('Proof'))).toEqual({ tone: 'success', label: '✓' });
  });

  it("shows the current stage's readiness as the stage recommendations gave it", () => {
    const at = (verdict: NonNullable<ProductionChapter['readiness']>['verdict'] | null) =>
      boardCell(chapter({ status: 'editing', readiness: verdict ? { verdict, reason: '' } : null }), column('Edit'));
    expect(at('recommended')).toEqual({ tone: 'info', label: 'Ready' });
    expect(at('not_ready')).toEqual({ tone: 'warning', label: 'Not ready' });
    expect(at('unknown')).toEqual({ tone: 'progress', label: 'Not checked' });
    expect(at('none')).toEqual({ tone: 'progress', label: 'In progress' });
    expect(at(null)).toEqual({ tone: 'progress', label: 'In progress' });
  });

  it('says a readiness column with no producer yet is not available (PRD risk table), as a dash (PR10)', () => {
    for (const name of ['Prep', 'Pickups', 'Master', 'QC']) {
      expect(boardCell(chapter({ status: 'finalized' }), column(name))).toEqual({ tone: 'neutral', label: '—' });
    }
  });

  it("shows a chapter's measured recorded length as m:ss, or says why it has none (Home's Actual recorded reasons)", () => {
    expect(boardCell(chapter({ recordedSeconds: 708 }), column('Recorded'))).toEqual({ tone: 'neutral', label: '11:48' });
    expect(boardCell(chapter({ recordedSeconds: null }), column('Recorded'))).toEqual({ tone: 'neutral', label: 'No track' });
    expect(boardCell(chapter({ recordedUnavailable: 'unlinked' }), column('Recorded'))).toEqual({ tone: 'neutral', label: 'No track' });
    expect(boardCell(chapter({ recordedUnavailable: 'multiple_tracks' }), column('Recorded'))).toEqual({ tone: 'warning', label: '2+ tracks' });
    expect(boardCell(chapter({ recordedUnavailable: 'track_missing' }), column('Recorded'))).toEqual({ tone: 'danger', label: 'Track missing' });
    expect(boardCell(chapter({ recordedUnavailable: 'no_project' }), column('Recorded'))).toEqual({ tone: 'neutral', label: 'No project' });
  });

  it('shows a chapter not started yet as a dash on its Record stage, whatever its readiness (PR10)', () => {
    const notStarted = chapter({ status: 'not_started', readiness: { verdict: 'recommended', reason: '' } });
    expect(boardCell(notStarted, column('Record'))).toEqual({ tone: 'neutral', label: '—' });
    expect(boardCell(notStarted, column('Edit'))).toEqual({ tone: 'neutral', label: '—' });
  });

  it('says the evidence changed on the current stage of a chapter whose confirmation it contradicts', () => {
    const editing = chapter({ status: 'editing', readiness: { verdict: 'none', reason: '' } });
    expect(boardCell(editing, column('Edit'), { contradiction: true })).toEqual({ tone: 'warning', label: 'Changed' });
    // Only the current stage: a stage already passed stays done.
    expect(boardCell(editing, column('Record'), { contradiction: true })).toEqual({ tone: 'success', label: '✓' });
  });

  it('shows a recording check running on the Record cell, with its percent once there is one', () => {
    const editing = chapter({ status: 'editing' });
    expect(boardCell(editing, column('Record'), { checkingPercent: 70.6 })).toEqual({ tone: 'progress', label: '70%' });
    expect(boardCell(editing, column('Record'), { checkingPercent: null })).toEqual({ tone: 'progress', label: 'Checking' });
    expect(boardCell(editing, column('Edit'), { checkingPercent: 70 })).toEqual({ tone: 'progress', label: 'In progress' });
  });

  it("finds a chapter's current stage: its own status, or Record for a chapter not started yet", () => {
    expect(isCurrentStage({ status: 'editing' }, column('Edit'))).toBe(true);
    expect(isCurrentStage({ status: 'editing' }, column('Record'))).toBe(false);
    expect(isCurrentStage({ status: 'not_started' }, column('Record'))).toBe(true);
    expect(isCurrentStage({ status: 'finalized' }, column('Proof'))).toBe(false);
    expect(isCurrentStage({ status: 'recording' }, column('Recorded'))).toBe(false);
    expect(isCurrentStage({ status: 'recording' }, column('Prep'))).toBe(false);
  });
});

describe('a credits row on the board', () => {
  const row = (status: ProductionChapter['status'], template: unknown = { name: 'Opening' }) => ({ status, template });

  it('reads its stages from its status alone, never a readiness', () => {
    expect(creditsCell(row('not_started'), column('Record'))).toEqual({ tone: 'neutral', label: '—' });
    expect(creditsCell(row('editing'), column('Record'))).toEqual({ tone: 'success', label: '✓' });
    expect(creditsCell(row('editing'), column('Edit'))).toEqual({ tone: 'progress', label: 'In progress' });
    expect(creditsCell(row('editing'), column('Proof'))).toEqual({ tone: 'neutral', label: '—' });
    expect(creditsCell(row('finalized'), column('Proof'))).toEqual({ tone: 'success', label: '✓' });
  });

  it('shows its own measured Recorded length, why it has none, or that the template is not set up (Phase 3)', () => {
    expect(creditsCell(row('recording'), column('Recorded'))).toEqual({ tone: 'neutral', label: 'No track' });
    expect(creditsCell({ ...row('recording'), recordedSeconds: 7 }, column('Recorded'))).toEqual({ tone: 'neutral', label: '0:07' });
    expect(creditsCell({ ...row('recording'), recordedUnavailable: 'track_missing' }, column('Recorded'))).toEqual({ tone: 'danger', label: 'Track missing' });
    expect(creditsCell({ status: 'recording' }, column('Recorded'))).toEqual({ tone: 'neutral', label: 'Not set up' });
    expect(creditsCell(row('recording'), column('QC'))).toEqual({ tone: 'neutral', label: '—' });
  });
});

describe('the delivery date in the subtitle', () => {
  it('writes the due date and the days left, or says it is today or over', () => {
    expect(deliveryDue({ date: '2026-10-14', daysLeft: 18 })).toBe('delivery due Oct 14 (18 days)');
    expect(deliveryDue({ date: '2026-09-27', daysLeft: 1 })).toBe('delivery due Sep 27 (1 day)');
    expect(deliveryDue({ date: '2026-09-26', daysLeft: 0 })).toBe('delivery due Sep 26 (today)');
    expect(deliveryDue({ date: '2026-09-20', daysLeft: -2 })).toBe('delivery was due Sep 20 (2 days over)');
  });

  it('is empty with no delivery date set', () => {
    expect(deliveryDue(null)).toBe('');
  });
});

describe('next up', () => {
  it('says what to do next and why the chapter is listed', () => {
    expect(nextUpLine({ chapterId: 'c', title: 'T', stage: 'editing', readiness: { verdict: 'not_ready', reason: '3 clicks left' } })).toEqual({
      action: 'Finish editing',
      reason: '3 clicks left',
    });
    expect(nextUpLine({ chapterId: 'c', title: 'T', stage: 'proofing', readiness: { verdict: 'recommended', target: 'finalized', reason: '' } })).toEqual({
      action: 'Finish proofing',
      reason: 'Looks ready to move to Finalized: confirm it from its cell on the board.',
    });
    expect(nextUpLine({ chapterId: 'c', title: 'T', stage: 'not_started', readiness: null })).toEqual({
      action: 'Start recording',
      reason: 'Not started yet.',
    });
    expect(nextUpLine({ chapterId: 'c', title: 'T', stage: 'recording', readiness: { verdict: 'none', reason: '' } })).toEqual({
      action: 'Finish recording',
      reason: 'In progress.',
    });
  });
});
