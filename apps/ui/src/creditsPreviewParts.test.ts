import { describe, expect, it } from 'vitest';
import { previewParts } from './creditsPreviewParts';
import type { CreditsRenderResult } from './api/contracts/credits';

describe('previewParts', () => {
  it('returns the whole text as one string when nothing is unresolved', () => {
    const result: CreditsRenderResult = { text: 'Alice, written by Lewis Carroll, narrated by You.', words: 7, unresolved: [] };
    expect(previewParts(result)).toEqual(['Alice, written by Lewis Carroll, narrated by You.']);
  });

  it('splits an unresolved token out as its own chip marker, keeping surrounding text as strings', () => {
    const result: CreditsRenderResult = { text: '[Title], written by Lewis Carroll, narrated by You.', words: 7, unresolved: ['Title'] };
    expect(previewParts(result)).toEqual([{ token: 'Title' }, ', written by Lewis Carroll, narrated by You.']);
  });

  it('splits out every unresolved token when several are unresolved, in the order they appear in the text', () => {
    const result: CreditsRenderResult = {
      text: '[Title], written by [Author], narrated by [Narrator].',
      words: 7,
      unresolved: ['Title', 'Author', 'Narrator'],
    };
    expect(previewParts(result)).toEqual([{ token: 'Title' }, ', written by ', { token: 'Author' }, ', narrated by ', { token: 'Narrator' }, '.']);
  });

  it('treats a resolved token that happens to share a name with an unresolved one correctly (only the unresolved occurrence becomes a chip)', () => {
    // Render never repeats a placeholder as literal text for a resolved token - this guards the regex construction
    // itself (built only from result.unresolved, per PRD C6) rather than matching every "[Name]"-shaped substring.
    const result: CreditsRenderResult = { text: 'Copyright by [Copyright].', words: 3, unresolved: ['Copyright'] };
    expect(previewParts(result)).toEqual(['Copyright by ', { token: 'Copyright' }, '.']);
  });

  it('escapes token names containing regex-special characters', () => {
    const result: CreditsRenderResult = { text: 'Book [Book (Series)].', words: 2, unresolved: ['Book (Series)'] };
    expect(previewParts(result)).toEqual(['Book ', { token: 'Book (Series)' }, '.']);
  });
});
