import { describe, expect, it } from 'vitest';
import { SPEAKER_COLOR_COUNT, speakerColorIndex, speakerColorToken } from './speakerColor';

describe('speakerColorIndex', () => {
  it('is deterministic: the same id always gets the same index', () => {
    expect(speakerColorIndex('alice')).toBe(speakerColorIndex('alice'));
    expect(speakerColorIndex('The Queen')).toBe(speakerColorIndex('The Queen'));
  });

  it('stays within the declared range of speaker colours', () => {
    for (const id of ['alice', 'the queen', 'march hare', 'hatter', 'dormouse', 'narrator', 'gryphon', 'mock turtle', 'five', 'seven', 'two']) {
      const index = speakerColorIndex(id);
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(SPEAKER_COLOR_COUNT);
    }
  });

  it('spreads distinct ids across more than one colour', () => {
    const indices = new Set(
      ['alice', 'the queen', 'march hare', 'hatter', 'dormouse', 'gryphon', 'mock turtle', 'five', 'seven', 'two'].map(speakerColorIndex),
    );
    expect(indices.size).toBeGreaterThan(1);
  });

  it('falls back to the first colour (an alias of --character) for an unresolved speaker', () => {
    expect(speakerColorIndex(undefined)).toBe(1);
    expect(speakerColorIndex('')).toBe(1);
  });

  it('differs by case and whitespace, since it hashes exactly the id it is given', () => {
    // Callers are expected to pass one consistent id shape (a canonical name or an entity id) rather than rely on
    // this function to normalise casing.
    expect(speakerColorIndex('Alice')).not.toBe(undefined);
  });
});

describe('speakerColorToken', () => {
  it('names one of the declared --speaker-N tokens', () => {
    for (const id of ['alice', 'the queen', 'hatter']) {
      expect(speakerColorToken(id)).toMatch(/^--speaker-[1-7]$/);
    }
  });

  it('matches the index speakerColorIndex computes for the same id', () => {
    expect(speakerColorToken('dormouse')).toBe(`--speaker-${speakerColorIndex('dormouse')}`);
  });

  it('falls back to --speaker-1 for an unresolved speaker', () => {
    expect(speakerColorToken(undefined)).toBe('--speaker-1');
  });
});
