import type { ManuscriptChapter, ManuscriptParagraph } from '../types';

// The browser demo uses the complete Project Gutenberg plain-text edition.
// It is parsed into the same chapter/paragraph model as an imported project,
// so scrolling, search, bookmarks, and source-line navigation run against a
// normal novel rather than a small excerpt fixture. The file ships with the mock
// build (fixtures/alice-in-wonderland.txt, Project Gutenberg eBook #11 exactly as
// published by GITenberg, 11-0.txt, with its licence), loaded as a chunk of its
// own on first use: the demo makes no request to GitHub, and the desktop app,
// which never runs the mock, never loads the chunk.
const readBundledText = async (): Promise<string> => (await import('./fixtures/alice-in-wonderland.txt?raw')).default;

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
      // Chapters 1-3 were checked and read in full, 4-6 were checked with a third of their text still to record, the rest were never
      // checked, so their recorded length is the estimate from their status (docs/utilities/recording-coverage.md D11, Q12).
      ...(index < 6 ? { recordedFraction: index < 3 ? 1 : 0.65 } : {}),
      status: index < 3 ? 'finalized' : index < 6 ? 'recording' : index < 8 ? 'editing' : index < 10 ? 'proofing' : 'not_started',
    };
  });
  return paragraphs.length > 200 ? { chapters, paragraphs } : undefined;
}

export async function loadAliceManuscript(
  seeds: readonly ChapterSeed[],
  readText: () => Promise<string> = readBundledText,
): Promise<{ chapters: ManuscriptChapter[]; paragraphs: ManuscriptParagraph[] } | undefined> {
  try {
    return parseAliceManuscript(await readText(), seeds);
  } catch {
    // A chunk that fails to load leaves the mock usable with the compact local seed fixture.
    return undefined;
  }
}
