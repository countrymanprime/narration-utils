// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CREDITS_EXPANDED, loadCreditsExpanded, saveCreditsExpanded } from './creditsExpandedStorage';

afterEach(() => window.localStorage.clear());

describe('credits open state per project (manuscript-credits-card-parity.prd.md, MC5 b)', () => {
  it('opens by default when nothing is stored', () => {
    expect(loadCreditsExpanded('/projects/alice')).toEqual(DEFAULT_CREDITS_EXPANDED);
  });

  it('round-trips a saved state, keyed by project so two projects do not share one', () => {
    saveCreditsExpanded('/projects/alice', { opening: false, closing: true });
    expect(loadCreditsExpanded('/projects/alice')).toEqual({ opening: false, closing: true });
    expect(loadCreditsExpanded('/projects/other')).toEqual(DEFAULT_CREDITS_EXPANDED);
  });

  it('falls back to the default when the stored value is not the expected shape', () => {
    window.localStorage.setItem('narration.manuscript.creditsExpanded./projects/alice', '"not an object"');
    expect(loadCreditsExpanded('/projects/alice')).toEqual(DEFAULT_CREDITS_EXPANDED);
    window.localStorage.setItem('narration.manuscript.creditsExpanded./projects/alice', 'not even json');
    expect(loadCreditsExpanded('/projects/alice')).toEqual(DEFAULT_CREDITS_EXPANDED);
  });

  it('never throws when storage is unavailable', () => {
    const real = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('storage blocked');
    };
    expect(() => saveCreditsExpanded('/projects/alice', { opening: false, closing: false })).not.toThrow();
    window.localStorage.setItem = real;
  });
});
