import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chapterName, context } from './chapterName';

describe('chapterName', () => {
  it('joins title and subtitle with an em dash, in source casing', () => {
    expect(chapterName({ title: 'PROLOGUE', subtitle: 'The Last Good Applause' })).toBe('PROLOGUE — The Last Good Applause');
  });

  it('gives the title alone when there is no subtitle, with no dangling separator', () => {
    expect(chapterName({ title: 'A Message from the Author' })).toBe('A Message from the Author');
    expect(chapterName({ title: 'A Message from the Author', subtitle: '' })).toBe('A Message from the Author');
  });

  it('keeps a title that carries its own colon intact when there is no subtitle', () => {
    expect(chapterName({ title: 'Chapter 6: The Storm' })).toBe('Chapter 6: The Storm');
  });

  it('drops a separator the title already ends with before adding its own, so the name never doubles up', () => {
    expect(chapterName({ title: 'CHAPTER ONE:', subtitle: 'Down the Rabbit-Hole' })).toBe('CHAPTER ONE — Down the Rabbit-Hole');
    expect(chapterName({ title: 'Chapter One —', subtitle: 'Down the Rabbit-Hole' })).toBe('Chapter One — Down the Rabbit-Hole');
  });

  it('short is always the title alone, even with a subtitle', () => {
    expect(chapterName({ title: 'PROLOGUE', subtitle: 'The Last Good Applause' }, 'short')).toBe('PROLOGUE');
  });

  it('a context prefix comes before the full name, separated by a colon', () => {
    expect(chapterName({ title: 'PROLOGUE', subtitle: 'The Last Good Applause' }, context('Read aloud'))).toBe('Read aloud: PROLOGUE — The Last Good Applause');
    expect(chapterName({ title: 'PROLOGUE' }, context('Recording check'))).toBe('Recording check: PROLOGUE');
  });

  it('reads a legacy "\\n"-joined title (the old Go/Python display helpers) as title plus subtitle', () => {
    expect(chapterName({ title: 'PROLOGUE\nThe Last Good Applause' })).toBe('PROLOGUE — The Last Good Applause');
  });

  it('an explicit subtitle wins over a legacy newline in the title', () => {
    expect(chapterName({ title: 'PROLOGUE\nstray', subtitle: 'The Last Good Applause' })).toBe('PROLOGUE — The Last Good Applause');
  });

  it('collapses internal whitespace', () => {
    expect(chapterName({ title: '  Chapter   One  ', subtitle: '  Down the   Rabbit-Hole ' })).toBe('Chapter One — Down the Rabbit-Hole');
  });
});

// fast-check with the repo's fixed global seed (ADR 0044): deterministic in the gate, 200 runs.
describe('chapterName properties', () => {
  const titleArb = fc.string({ minLength: 1 }).filter((title) => squashed(title).length > 0 && !title.includes('\n'));
  const subtitleArb = fc.option(
    fc.string().filter((subtitle) => !subtitle.includes('\n')),
    { nil: undefined },
  );

  function squashed(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  // Only for a title that does not itself end in a separator character: that case is the one the trailing-separator
  // rule exists for (chapterName.test.ts's "drops a separator the title already ends with" case above), and there
  // `full`'s title portion is deliberately shorter than `short`'s raw title, on purpose.
  const titleWithNoTrailingSeparatorArb = titleArb.filter((title) => !/[:—–-]\s*$/.test(title));

  it('full always contains short, for a title that does not already end in a separator', () => {
    fc.assert(
      fc.property(titleWithNoTrailingSeparatorArb, subtitleArb, (title, subtitle) => {
        const chapter = { title, subtitle };
        expect(chapterName(chapter, 'full')).toContain(chapterName(chapter, 'short'));
      }),
    );
  });

  it('never produces a doubled separator or a dangling one', () => {
    fc.assert(
      fc.property(titleArb, subtitleArb, (title, subtitle) => {
        const full = chapterName({ title, subtitle });
        expect(full).not.toContain(' —  — ');
        expect(full.startsWith('—')).toBe(false);
        expect(full.endsWith('—')).toBe(false);
        expect(full).not.toMatch(/: —/);
      }),
    );
  });

  it('a context prefix always starts the result and short is always the bare title', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), titleArb, subtitleArb, (prefix, title, subtitle) => {
        const chapter = { title, subtitle };
        expect(chapterName(chapter, context(prefix))).toBe(`${prefix}: ${chapterName(chapter, 'full')}`);
        expect(chapterName(chapter, 'short')).toBe(squashed(title));
      }),
    );
  });
});
