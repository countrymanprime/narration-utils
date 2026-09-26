import { describe, expect, it } from 'vitest';
import type { Finding } from '../../types';
import { candidateAudition, candidateClass, candidateReason, sortCandidates } from './editingCheckText';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    schema_version: 1,
    id: 'f1',
    analyzer: 'editing',
    project: {},
    source: { file: 'C:/media/ch1.wav' },
    time_range: { start: 10, end: 12, source_start: 10, source_end: 12 },
    category: 'silence_cleanup',
    severity: 'info',
    confidence: 0.6,
    confidence_reason: 'not a calibrated score',
    evidence: { class: 'silence', reason: 'a gap candidate' },
    review: { status: 'unreviewed' },
    ...overrides,
  };
}

describe('candidateClass', () => {
  it('reads a known class from evidence', () => {
    expect(candidateClass(finding({ evidence: { class: 'click' } }))).toBe('click');
  });

  it('is undefined for an unknown or missing class', () => {
    expect(candidateClass(finding({ evidence: { class: 'unknown-thing' } }))).toBeUndefined();
    expect(candidateClass(finding({ evidence: {} }))).toBeUndefined();
    expect(candidateClass(finding({ evidence: undefined }))).toBeUndefined();
  });
});

describe('candidateReason', () => {
  it('prefers evidence.reason over confidence_reason', () => {
    expect(candidateReason(finding({ evidence: { reason: 'the real reason' }, confidence_reason: 'fallback' }))).toBe('the real reason');
  });

  it('falls back to confidence_reason when evidence.reason is missing', () => {
    expect(candidateReason(finding({ evidence: {}, confidence_reason: 'fallback' }))).toBe('fallback');
  });
});

describe('candidateAudition', () => {
  it('gives a playable range when source file and offsets are all present', () => {
    expect(candidateAudition(finding())).toEqual({ sourceFile: 'C:/media/ch1.wav', rangeStart: 10, rangeEnd: 12 });
  });

  it('is undefined for a candidate with no source-relative range (a pure timeline gap)', () => {
    expect(candidateAudition(finding({ time_range: { start: 10, end: 12 } }))).toBeUndefined();
  });

  it('is undefined with no source file', () => {
    expect(candidateAudition(finding({ source: {} }))).toBeUndefined();
  });
});

describe('sortCandidates', () => {
  it('orders candidates earliest first without mutating the input', () => {
    const later = finding({ id: 'later', time_range: { start: 30, end: 31 } });
    const earlier = finding({ id: 'earlier', time_range: { start: 5, end: 6 } });
    const input = [later, earlier];
    const sorted = sortCandidates(input);
    expect(sorted.map((item) => item.id)).toEqual(['earlier', 'later']);
    expect(input.map((item) => item.id)).toEqual(['later', 'earlier']);
  });
});
