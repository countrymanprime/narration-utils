import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAliceManuscript, parseAliceManuscript } from './aliceManuscript';
import { aliceChapterSeeds } from './mockFixtures';

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
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns undefined when there is no fetch in this environment', async () => {
    // @ts-expect-error deliberately removing fetch to exercise the environment guard
    delete globalThis.fetch;
    await expect(loadAliceManuscript(aliceChapterSeeds)).resolves.toBeUndefined();
  });

  it('returns undefined, without throwing, when the request fails (offline)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(loadAliceManuscript(aliceChapterSeeds)).resolves.toBeUndefined();
  });

  it('returns undefined when the response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve('') });
    await expect(loadAliceManuscript(aliceChapterSeeds)).resolves.toBeUndefined();
  });

  it('parses the response body when the request succeeds', async () => {
    const source = sourceWith(12, 20);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(source) });

    const manuscript = await loadAliceManuscript(aliceChapterSeeds);

    expect(manuscript?.chapters).toHaveLength(12);
  });
});
