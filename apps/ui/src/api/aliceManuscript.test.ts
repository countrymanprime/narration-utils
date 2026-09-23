import { describe, expect, it, vi } from 'vitest';
import { parseAliceManuscript } from './aliceManuscript';
import { aliceChapterSeeds } from './mockFixtures';

// test-setup.ts stubs the loader for every other test (the parser is the real one); these tests read the real loader.
const { loadAliceManuscript } = await vi.importActual<typeof import('./aliceManuscript')>('./aliceManuscript');

const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function sourceWith(chapterCount: number, paragraphsPerChapter: number): string {
  return aliceChapterSeeds
    .slice(0, chapterCount)
    .map((chapter, index) => {
      const heading = `CHAPTER ${romanNumerals[index]}. ${chapter.subtitle}`;
      const paragraphs = Array.from({ length: paragraphsPerChapter }, (_, paragraph) => `Alice paragraph ${paragraph + 1} in ${chapter.subtitle}.`);
      return [heading, paragraphs.join('\n\n')].join('\n\n');
    })
    .join('\n\n');
}

describe('parseAliceManuscript', () => {
  it('turns all twelve source chapters into real paragraph and source-line records', () => {
    const source = sourceWith(12, 20);
    const manuscript = parseAliceManuscript(source, aliceChapterSeeds);

    expect(manuscript?.chapters).toHaveLength(12);
    expect(manuscript?.paragraphs).toHaveLength(240);
    expect(manuscript?.paragraphs[0]).toMatchObject({ chapter: 'Chapter 1', sourceLine: 3, text: 'Alice paragraph 1 in Down the Rabbit-Hole.' });
    expect(manuscript?.chapters[0].wordCount).toBeGreaterThan(100);
  });

  it('gives up when the text does not have exactly twelve "CHAPTER <roman>." headings (a different edition or an offline fallback)', () => {
    const source = sourceWith(11, 20);
    expect(parseAliceManuscript(source, aliceChapterSeeds)).toBeUndefined();
  });

  it('gives up when the parsed text has too few paragraphs to be the real book (a small excerpt, not the full text)', () => {
    const source = sourceWith(12, 1);
    expect(parseAliceManuscript(source, aliceChapterSeeds)).toBeUndefined();
  });
});

describe('loadAliceManuscript', () => {
  it('parses the bundled Project Gutenberg text into the twelve chapters of the book', async () => {
    const manuscript = await loadAliceManuscript(aliceChapterSeeds);

    expect(manuscript?.chapters).toHaveLength(12);
    expect(manuscript?.chapters[0]).toMatchObject({ subtitle: 'Down the Rabbit-Hole' });
    expect(manuscript?.paragraphs.length).toBeGreaterThan(200);
  });

  it('returns undefined, without throwing, when the text cannot be loaded', async () => {
    await expect(loadAliceManuscript(aliceChapterSeeds, () => Promise.reject(new Error('chunk failed')))).resolves.toBeUndefined();
  });

  it('parses the text it is given', async () => {
    const manuscript = await loadAliceManuscript(aliceChapterSeeds, () => Promise.resolve(sourceWith(12, 20)));

    expect(manuscript?.paragraphs).toHaveLength(240);
  });
});
