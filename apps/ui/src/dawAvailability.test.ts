import { describe, expect, it } from 'vitest';
import { combinedRequiredReason, dawCapabilityGate } from './dawAvailability';
import type { CapabilityEntry } from './components/primitives/CapabilityGate';

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

describe('dawCapabilityGate (DAW port PRD Phase 7)', () => {
  const AVAILABLE: CapabilityEntry = { level: 'supported', available: true };
  const UNAVAILABLE: CapabilityEntry = { level: 'experimental', available: false, message: 'Experimental: switched off in Settings.' };

  it('is enabled once the setup facts are met and the capability is available', () => {
    expect(dawCapabilityGate({ manuscript: false, dawFile: false }, AVAILABLE)).toEqual({ disabled: false });
  });

  it('reports the setup reason first, before ever looking at the capability', () => {
    expect(dawCapabilityGate({ manuscript: true, dawFile: true }, AVAILABLE)).toEqual({
      disabled: true,
      reason: 'Import a manuscript and link a REAPER project to unlock this page.',
    });
  });

  it("falls back to the capability's own message once the setup facts are met but it is unavailable", () => {
    expect(dawCapabilityGate({ manuscript: false, dawFile: false }, UNAVAILABLE)).toEqual({
      disabled: true,
      reason: 'Experimental: switched off in Settings.',
    });
  });
});
