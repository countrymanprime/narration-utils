import { describe, expect, it } from 'vitest';
import { parseAliceManuscript } from './aliceManuscript';
import { aliceChapterSeeds } from './mockFixtures';

const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

describe('parseAliceManuscript', () => {
  it('turns all twelve source chapters into real paragraph and source-line records', () => {
    const source = aliceChapterSeeds
      .map((chapter, index) => {
        const heading = `CHAPTER ${romanNumerals[index]}. ${chapter.subtitle}`;
        const paragraphs = Array.from({ length: 20 }, (_, paragraph) => `Alice paragraph ${paragraph + 1} in ${chapter.subtitle}.`);
        return [heading, paragraphs.join('\n\n')].join('\n\n');
      })
      .join('\n\n');
    const manuscript = parseAliceManuscript(source, aliceChapterSeeds);

    expect(manuscript?.chapters).toHaveLength(12);
    expect(manuscript?.paragraphs).toHaveLength(240);
    expect(manuscript?.paragraphs[0]).toMatchObject({ chapter: 'Chapter 1', sourceLine: 3, text: 'Alice paragraph 1 in Down the Rabbit-Hole.' });
    expect(manuscript?.chapters[0].wordCount).toBeGreaterThan(100);
  });
});
