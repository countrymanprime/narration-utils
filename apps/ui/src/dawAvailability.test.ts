import { describe, expect, it } from 'vitest';
import { combinedRequiredReason } from './dawAvailability';

describe('combinedRequiredReason', () => {
  it('returns undefined when nothing is missing', () => {
    expect(combinedRequiredReason({ manuscript: false, dawFile: false })).toBeUndefined();
  });

  it('names only the manuscript when only it is missing', () => {
    expect(combinedRequiredReason({ manuscript: true, dawFile: false })).toBe('Import a manuscript to unlock this page.');
  });

  it('names only the DAW file when only it is missing', () => {
    expect(combinedRequiredReason({ manuscript: false, dawFile: true })).toBe('Link a REAPER project to unlock this page.');
  });

  it('names both, joined with "and", when both are missing', () => {
    expect(combinedRequiredReason({ manuscript: true, dawFile: true })).toBe('Import a manuscript and link a REAPER project to unlock this page.');
  });
});
