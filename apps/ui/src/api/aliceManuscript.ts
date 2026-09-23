import type { ManuscriptChapter, ManuscriptParagraph } from '../types';

// The browser demo uses the complete Project Gutenberg plain-text edition.
// It is parsed into the same chapter/paragraph model as an imported project,
// so scrolling, search, bookmarks, and source-line navigation run against a
// normal novel rather than a small excerpt fixture.
const ALICE_TEXT_URL = 'https://raw.githubusercontent.com/GITenberg/Alice-s-Adventures-in-Wonderland_11/master/11-0.txt';
// A stalled download must not hold the mock client's manuscript calls forever:
// past this limit the compact local seed fixture is used instead, as when offline.
const ALICE_FETCH_TIMEOUT_MS = 5_000;

type ChapterSeed = { title: string; subtitle: string };

const roman = new Map([
  ['I', 1],
  ['II', 2],
  ['III', 3],
  ['IV', 4],
  ['V', 5],
  ['VI', 6],
  ['VII', 7],
  ['VIII', 8],
  ['IX', 9],
  ['X', 10],
  ['XI', 11],
  ['XII', 12],
]);

const cleanParagraph = (value: string) =>
  value
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

export function parseAliceManuscript(
  text: string,
  seeds: readonly ChapterSeed[],
): { chapters: ManuscriptChapter[]; paragraphs: ManuscriptParagraph[] } | undefined {
  const body = text.replace(/\r/g, '').split('*** END OF THE PROJECT GUTENBERG EBOOK')[0];
  // GITenberg's text puts headings and subtitles on one line; Project
  // Gutenberg's current export uses two. Accept both forms.
  const matches = [...body.matchAll(/^CHAPTER\s+([IVXLCDM]+)\.[ \t]*(?:\r?\n[ \t]*)?([^\r\n]+)\r?$/gm)];
  if (matches.length !== 12) return undefined;
  const paragraphs: ManuscriptParagraph[] = [];
  const chapters: ManuscriptChapter[] = matches.map((match, index) => {
    const number = roman.get(match[1]);
    const seed = seeds[(number || index + 1) - 1];
    if (!seed) throw new Error('Unexpected Alice chapter heading.');
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : body.length;
    const chapterText = body.slice(start, end);
    let searchFrom = 0;
    const rows = chapterText
      .split(/\n\s*\n/)
      .map((raw) => {
        const offset = chapterText.indexOf(raw, searchFrom);
        searchFrom = offset + raw.length;
        return { text: cleanParagraph(raw), sourceLine: body.slice(0, start + offset).split('\n').length };
      })
      .filter((paragraph) => paragraph.text && !/^\[Illustration/.test(paragraph.text) && !/^\*\s*\*/.test(paragraph.text));
    const firstParagraph = paragraphs.length;
    rows.forEach((row, localIndex) =>
      paragraphs.push({
        id: `p-${firstParagraph + localIndex + 1}`,
        chapterId: `chapter-${index + 1}`,
        chapter: seed.title,
        index: firstParagraph + localIndex,
        sourceLine: row.sourceLine,
        text: row.text,
        entityIds: [],
      }),
    );
    return {
      id: `chapter-${index + 1}`,
      title: seed.title,
      subtitle: seed.subtitle,
      index,
      wordCount: rows.flatMap((row) => row.text.split(/\s+/)).filter(Boolean).length,
      recordedFraction: index < 3 ? 1 : index < 6 ? 0.65 : 0,
      status: index < 3 ? 'finalized' : index < 6 ? 'recording' : index < 8 ? 'editing' : index < 10 ? 'proofing' : 'not_started',
    };
  });
  return paragraphs.length > 200 ? { chapters, paragraphs } : undefined;
}

export async function loadAliceManuscript(
  seeds: readonly ChapterSeed[],
): Promise<{ chapters: ManuscriptChapter[]; paragraphs: ManuscriptParagraph[] } | undefined> {
  if (typeof fetch !== 'function') return undefined;
  try {
    const response = await fetch(ALICE_TEXT_URL, { signal: AbortSignal.timeout(ALICE_FETCH_TIMEOUT_MS) });
    return response.ok ? parseAliceManuscript(await response.text(), seeds) : undefined;
  } catch {
    // Offline/test clients remain usable with the compact local seed fixture.
    return undefined;
  }
}
