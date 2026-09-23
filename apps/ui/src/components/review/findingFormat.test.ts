import { describe, expect, it } from 'vitest';
import { WIRE_FINDINGS } from '../../api/mockFixtures';
import { FINDING_CATEGORIES } from '../../api/contracts/findings';
import { analyzerLabel, categoryLabel, confidenceLabel, evidenceRows, findingSummary, formatDecidedAt, formatTime } from './findingFormat';

describe('findingFormat', () => {
  it('words every documented category, and a newer one as words rather than an identifier', () => {
    for (const category of FINDING_CATEGORIES) expect(categoryLabel(category)).not.toContain('_');
    expect(categoryLabel('breath_noise')).toBe('Breath noise');
    expect(analyzerLabel('room-tone-check')).toBe('Room tone check');
  });

  it('shows a score as a percentage and no score as no score', () => {
    expect(confidenceLabel(0.9)).toBe('90%');
    expect(confidenceLabel(0)).toBe('0%');
    expect(confidenceLabel(null)).toBe('No score');
  });

  it('formats project time as minutes and tenths of a second', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(12.44)).toBe('0:12.4');
    expect(formatTime(59.96)).toBe('1:00.0');
    expect(formatTime(754.25)).toBe('12:34.3');
  });

  it('sums up a finding by what was expected and what was heard', () => {
    const [misread, skipped, extra, entity] = WIRE_FINDINGS;
    expect(findingSummary(misread)).toBe('“a White Rabbit with pink eyes” read as “a white rabbit with pale eyes”');
    expect(findingSummary(skipped)).toBe('“Oh dear!” not heard');
    expect(findingSummary(extra)).toBe('“and then” heard, not in the script');
    expect(findingSummary(entity)).toBe('“White Rabbit”');
    expect(findingSummary({ ...entity, manuscript: undefined })).toBe('Story Bible entry');
  });

  it('lists the evidence it knows how to word, in reading order, and leaves the rest out', () => {
    expect(evidenceRows(WIRE_FINDINGS[2])).toEqual([
      { label: 'Kind', value: 'Extra words' },
      { label: 'Script', value: 'Curiouser and curiouser!' },
      { label: 'Recording', value: 'Curiouser and then curiouser!' },
      { label: 'Existing REAPER marker', value: 'TAKE 2' },
    ]);
    expect(evidenceRows({ ...WIRE_FINDINGS[0], evidence: { kind: 'SWAPPED', marker_state: 'pending', timing_gap_seconds: 'n/a' } })).toEqual([
      { label: 'Kind', value: 'Swapped' },
    ]);
  });

  it('shows a decision time that is not a date as it came', () => {
    expect(formatDecidedAt(undefined)).toBeUndefined();
    expect(formatDecidedAt('yesterday')).toBe('yesterday');
    expect(formatDecidedAt('2026-09-21T10:00:00Z')).toMatch(/2026/);
  });
});
