import { describe, expect, it } from 'vitest';
import type { ProductionChapter } from '../../api/contracts/production';
import { boardCell, BOARD_COLUMNS, deadlineFigure, formatClock, formatLength, formatPfh, formatRate, nextUpLine, stageHoursHint } from './productionFormat';

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
  it('marks the stages a chapter has passed as done and the ones ahead as not yet', () => {
    const proofing = chapter({ status: 'proofing' });
    expect(boardCell(proofing, column('Record'))).toEqual({ tone: 'success', label: 'Done' });
    expect(boardCell(proofing, column('Edit'))).toEqual({ tone: 'success', label: 'Done' });
    const recording = chapter({ status: 'recording' });
    expect(boardCell(recording, column('Proof'))).toEqual({ tone: 'neutral', label: 'Not yet' });
    expect(boardCell(chapter({ status: 'finalized' }), column('Proof'))).toEqual({ tone: 'success', label: 'Done' });
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

  it('says a readiness column with no producer yet is not available (PRD risk table)', () => {
    for (const name of ['Prep', 'Delivery']) {
      expect(boardCell(chapter({ status: 'finalized' }), column(name))).toEqual({ tone: 'neutral', label: 'Not available' });
    }
  });

  it("shows a chapter's measured recorded length as m:ss, or says it is not measured", () => {
    expect(boardCell(chapter({ recordedSeconds: 708 }), column('Recorded'))).toEqual({ tone: 'neutral', label: '11:48' });
    expect(boardCell(chapter({ recordedSeconds: null }), column('Recorded'))).toEqual({ tone: 'neutral', label: 'Not measured' });
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
      reason: 'Looks ready to move to Finalized: confirm it on Home.',
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
