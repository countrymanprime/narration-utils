import { describe, expect, it } from 'vitest';
import { sourcesOf } from './NotesHeader';

describe('sourcesOf (mock 04: "Sources: proofer (CSV) · local AI compare · my flags")', () => {
  it('names the proofer first, then the local AI compare, then the rest', () => {
    expect(sourcesOf(['story-bible', 'transcript-compare'], true)).toEqual(['proofer (CSV)', 'local AI compare', 'Story Bible']);
  });

  it('names only the sources that have notes, and words an unknown one plainly', () => {
    expect(sourcesOf([], false)).toEqual([]);
    expect(sourcesOf(['editing'], false)).toEqual(['editing']);
  });
});
