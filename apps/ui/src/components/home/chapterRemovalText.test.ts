import { describe, expect, it } from 'vitest';
import { removalKindLabel, removedWhenLabel } from './chapterRemovalText';

describe('removalKindLabel', () => {
  it('names a reference chapter "not a chapter"', () => {
    expect(removalKindLabel('reference')).toBe('not a chapter');
  });

  it('names an opening chapter "front matter"', () => {
    expect(removalKindLabel('opening')).toBe('front matter');
  });
});

describe('removedWhenLabel', () => {
  const now = new Date('2026-09-25T18:00:00Z');

  it('says today for the same calendar day', () => {
    expect(removedWhenLabel('2026-09-25T09:00:00Z', now)).toBe('today');
  });

  it('says yesterday for the day before', () => {
    expect(removedWhenLabel('2026-09-24T09:00:00Z', now)).toBe('yesterday');
  });

  it('gives a plain date further back', () => {
    expect(removedWhenLabel('2026-09-01T09:00:00Z', now)).toBe(new Date('2026-09-01T09:00:00Z').toLocaleDateString(undefined, { dateStyle: 'medium' }));
  });
});
