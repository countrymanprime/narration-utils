// The mock host (mockApi.ts): the manuscript.
import type {
  GuideEvidence,
  ManuscriptChapter,
  ManuscriptContentKind,
  ManuscriptNote,
  ManuscriptParagraph,
  NarrationApi,
  ReaderBookmark,
  ReaderState,
  WorkJob,
} from '../../types';
import { aliceChapterSeeds, WIRE_NOTES, WIRE_READER_STATE, WIRE_TRACKS_PROJECT, wireClone, withFormatting } from '../mockFixtures';
import { loadAliceManuscript } from '../aliceManuscript';
import { mockRecordedLength } from '../chapterTrackMatchMock';
import { mockImportPreview, mockImportPreviewLog } from '../mockImportPreview';
import type { MockApiSeed, MockState } from './state';

// `?mockManuscript=mixed` (manuscript-chapter-header-alignment.prd.md; heading cases added by
// chapter-title-display-consistency.prd.md Phase 1): a buttonless row (Front Matter, contentKind 'opening') before
// the narration chapters, one narration chapter's word count raised to 5 digits, so the header's stat block and
// action slot can be shown lining up across a 3-, a 4- and a 5-digit count, with and without a Read aloud button,
// and four of the owner's heading shapes (mockups/chapter-title-display-consistency/02-home-table-*.webp) so
// chapterName()/TitleSubtitle can be seen against a title in source capitals with a subtitle, a title with no
// subtitle at all, a subtitle long enough to wrap, and a one-line heading that already ends in a colon before the
// formatter appends its own " — subtitle" - without a second, forked mock. A pure function (not inlined in the
// Alice-loading promise chain) so it has its own unit test, independent of whether the bundled Alice text loads in
// a given environment.
export function applyMixedManuscriptMock(
  chapters: ManuscriptChapter[],
  paragraphs: ManuscriptParagraph[],
): { chapters: ManuscriptChapter[]; paragraphs: ManuscriptParagraph[] } {
  const frontMatterId = 'front-matter';
  const frontMatterParagraph: ManuscriptParagraph = {
    id: 'p-front-matter-0',
    chapterId: frontMatterId,
    chapter: 'Front Matter',
    index: -1,
    sourceLine: 1,
    text: 'Also by the same author.',
    entityIds: [],
  };
  const frontMatter: ManuscriptChapter = {
    id: frontMatterId,
    title: 'Front Matter',
    index: -1,
    wordCount: 318,
    status: 'not_started',
    contentKind: 'opening',
    paragraphIds: [{ id: frontMatterParagraph.id, index: frontMatterParagraph.index }],
  };
  const withoutSubtitle = (chapter: ManuscriptChapter): ManuscriptChapter => {
    const rest = { ...chapter };
    delete rest.subtitle;
    return rest;
  };
  // Applied by index, so the two-chapter fixture in mockApi.test.ts still exercises the first two cases; the real
  // (12-chapter) Alice manuscript loaded by the browser demo shows all four.
  const headingCases: Record<number, (chapter: ManuscriptChapter) => ManuscriptChapter> = {
    0: (chapter) => ({ ...chapter, wordCount: 12_406, title: 'CHAPTER ONE', subtitle: 'Bad Ideas Look Great in Neon' }),
    1: (chapter) => withoutSubtitle({ ...chapter, title: 'A Message from the Author' }),
    2: (chapter) => ({
      ...chapter,
      subtitle: 'Or, How the Understudy Learned Every Line by Heart and Several That Were Cut in Rehearsal',
    }),
  };
  const mutated = chapters.map((chapter, index) => {
    const applyCase = headingCases[index];
    if (applyCase) return applyCase(chapter);
    // A heading that already ends in a separator: chapterName() must drop it, not double it up ("Chapter 12: — …").
    if (index === chapters.length - 1) return { ...chapter, title: `${chapter.title}:` };
    return chapter;
  });
  return {
    chapters: [frontMatter, ...mutated],
    paragraphs: [frontMatterParagraph, ...paragraphs],
  };
}

/** The manuscript bindings: the import, the chapters and paragraphs, the reader and its notes. */
export function createManuscriptMock(
  s: MockState,
  initial: MockApiSeed,
  { withMeasurement }: { withMeasurement: (chapter: ManuscriptChapter) => ManuscriptChapter },
) {
  // The kind each reclassified chapter was imported as (the host's `importedKind`), so Restore knows it was removed.
  const importedKinds = new Map<string, ManuscriptContentKind>();
  let notes = wireClone(WIRE_NOTES);
  let readerState: ReaderState = wireClone(WIRE_READER_STATE);
  const manuscriptReady = loadAliceManuscript(aliceChapterSeeds).then((loaded) => {
    if (!loaded) return;
    s.chapters = loaded.chapters;
    // The real text needs the same preserved formatting/line-break sample as
    // the seed fixture, so the reader shows both in either data source.
    s.paragraphs = loaded.paragraphs.map(withFormatting).map((paragraph) => ({
      ...paragraph,
      entityIds: s.entities
        .filter((entity) => [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)].some((term) => paragraph.text.includes(term)))
        .map((entity) => entity.id),
    }));
    // The host's chapter list carries each chapter's paragraph ids/indexes, which
    // "Go to line" deep links (#p<index>) use to find the owning chapter.
    s.chapters = s.chapters.map((chapter) => ({
      ...chapter,
      paragraphIds: s.paragraphs.filter((paragraph) => paragraph.chapterId === chapter.id).map(({ id, index }) => ({ id, index })),
    }));
    if (initial.mockManuscript === 'mixed') {
      const mixed = applyMixedManuscriptMock(s.chapters, s.paragraphs);
      s.chapters = mixed.chapters;
      s.paragraphs = mixed.paragraphs;
    }
    if (initial.removedChapter) {
      const last = [...s.chapters].reverse().find((chapter) => (chapter.contentKind ?? 'narration') === 'narration');
      if (last) {
        importedKinds.set(last.id, 'narration');
        s.chapters = s.chapters.map((chapter) =>
          chapter.id === last.id ? { ...chapter, contentKind: 'reference', kindChangedAt: '2026-09-25T12:00:00Z', removedFromRecording: true } : chapter,
        );
      }
    }
    // WIRE_ENTITIES' occurrence paragraph numbers are computed against the
    // small local seed fixture, not the real manuscript text just loaded
    // above, so they'd point at the wrong line ("go to line" landing
    // nowhere near the actual occurrence) - recompute them against the
    // paragraphs that are now actually in the reader.
    const evidenceFor = (term: string): GuideEvidence[] =>
      s.paragraphs
        .filter((paragraph) => paragraph.text.includes(term))
        .map((paragraph) => ({ chapter: paragraph.chapter, paragraph: paragraph.index, sourceLine: paragraph.sourceLine, excerpt: paragraph.text }));
    s.entities = s.entities.map((entity) => {
      const occurrences = evidenceFor(entity.canonical_name);
      const aliases = entity.aliases.map((alias) => ({ ...alias, occurrences: evidenceFor(alias.text) }));
      return {
        ...entity,
        occurrences,
        aliases,
        occurrence_count: occurrences.length + aliases.reduce((total, alias) => total + alias.occurrences.length, 0),
      };
    });
  });
  let importJob: WorkJob = { id: null, kind: 'manuscript_import', phase: 'idle', message: 'Ready to import.', percent: 0, logs: [], elapsed: 0 };
  // Choosing a file and accepting the offer of one both begin the same job; the preview it will answer is `initial.importPreview`.
  const startImport = () => {
    importJob = {
      id: 'mock-import',
      kind: 'manuscript_import',
      phase: 'preparing',
      message: 'Manuscript selected. Choose import options to continue.',
      percent: 0,
      logs: ['Selected manuscript'],
      elapsed: 0,
      preview: mockImportPreview(initial.importPreview),
      requiresReset: false,
    };
    return { selected: true, jobId: 'mock-import' };
  };
  const bindings = {
    selectManuscript: async () => startImport(),
    manuscriptBeginImport: async () => startImport(),
    manuscriptImportState: async () => wireClone(importJob),
    manuscriptImportPreview: async (_jobId, { markdownHeadingLevel }) => {
      importJob = {
        ...importJob,
        phase: 'ready',
        percent: 100,
        message: 'Import preview is ready.',
        // Mirrors the host's staged import log (apps/desktop/internal/importer).
        logs: [...importJob.logs, ...(importJob.preview ? mockImportPreviewLog(importJob.preview, markdownHeadingLevel) : [])],
      };
      return wireClone(importJob);
    },
    manuscriptImportCommit: async () => {
      const sourceName = importJob.preview?.sourceName ?? 'Alice.docx';
      const format = importJob.preview?.format ?? 'docx';
      importJob = {
        ...importJob,
        phase: 'success',
        percent: 100,
        message: 'Manuscript import complete.',
        logs: [
          ...importJob.logs,
          `Copying ${sourceName} (48 KB) into the project and computing its checksum`,
          'Writing manuscript.json',
          'Manuscript imported',
        ],
        result: { id: 'alice', format, sourceName, importedAt: '2026-01-01T00:00:00Z' },
      };
      return wireClone(importJob);
    },
    manuscriptImportCancel: async () => {
      importJob = { ...importJob, phase: 'cancelled', message: 'Manuscript import cancelled.' };
    },
    manuscriptChapters: async () => {
      await manuscriptReady;
      const readable = Boolean(s.tracksDiscovery.selected);
      return wireClone(
        s.chapters.map((chapter) => ({
          ...withMeasurement(chapter),
          ...mockRecordedLength(chapter.id, WIRE_TRACKS_PROJECT, s.chapterTrackMappings, readable),
        })),
      );
    },
    manuscriptParagraphs: async (chapter) => {
      await manuscriptReady;
      return wireClone(s.paragraphs.filter((paragraph) => paragraph.chapterId === chapter || paragraph.chapter === chapter));
    },
    manuscriptSearch: async (query) => {
      await manuscriptReady;
      const needle = query.toLowerCase();
      return wireClone(
        s.paragraphs
          .map((paragraph) => ({ paragraph, matchStart: paragraph.text.toLowerCase().indexOf(needle) }))
          .filter(({ matchStart }) => matchStart >= 0)
          .map(({ paragraph, matchStart }) => ({
            chapter: paragraph.chapter,
            chapterId: paragraph.chapterId,
            paragraph: paragraph.index,
            paragraphId: paragraph.id,
            sourceLine: paragraph.sourceLine,
            excerpt: paragraph.text,
            matchStart,
          })),
      );
    },
    // The host's ManuscriptSetChapterKind (apps/desktop/chapterkind.go): only the kind changes, and a removal clears the
    // chapter's links (chapter-track-link-control PRD Phase 3, TL5 A).
    manuscriptSetChapterKind: async (chapterId, kind) => {
      await manuscriptReady;
      const found = s.chapters.find((item) => item.id === chapterId);
      if (!found) throw new Error('unknown manuscript chapter');
      const previousKind = found.contentKind ?? 'narration';
      if (previousKind !== kind) {
        const narration = s.chapters.filter((item) => (item.contentKind ?? 'narration') === 'narration').length;
        if (previousKind === 'narration' && narration <= 1) throw new Error('the last narration chapter cannot be removed from recording');
        const importedKind = importedKinds.get(chapterId) ?? previousKind;
        importedKinds.set(chapterId, importedKind);
        const changed: ManuscriptChapter = { ...found, contentKind: kind, kindChangedAt: new Date().toISOString() };
        delete changed.removedFromRecording;
        const next = importedKind === 'narration' && kind !== 'narration' ? { ...changed, removedFromRecording: true as const } : changed;
        s.chapters = s.chapters.map((item) => (item.id === chapterId ? next : item));
      }
      const clearedLinks = kind === 'narration' ? [] : s.chapterTrackMappings.filter((link) => link.chapterId === chapterId);
      s.chapterTrackMappings = s.chapterTrackMappings.filter((link) => !clearedLinks.includes(link));
      const chapter = s.chapters.find((item) => item.id === chapterId) ?? found;
      return wireClone({ chapter: withMeasurement(chapter), previousKind, clearedLinks });
    },
    manuscriptSetChapterStatus: async (chapter, status) => {
      await manuscriptReady;
      const found = s.chapters.find((item) => item.id === chapter || item.title === chapter);
      if (!found) throw new Error(`Unknown chapter: ${chapter}`);
      found.status = status;
      return wireClone(withMeasurement(found));
    },
    noteList: async (chapter) => wireClone(chapter ? notes.filter((note) => note.chapter === chapter) : notes),
    manuscriptReader: async () => {
      await manuscriptReady;
      return { chapters: wireClone(s.chapters.map(withMeasurement)), paragraphs: wireClone(s.paragraphs), notes: wireClone(notes) };
    },
    readerState: async () => wireClone(readerState),
    readerStateSave: async (values) => {
      readerState = { ...readerState, ...values };
      return wireClone(readerState);
    },
    readerBookmarkCreate: async (bookmark) => {
      const item: ReaderBookmark = { ...bookmark, id: `bookmark-${s.nextId++}`, createdAt: new Date().toISOString() };
      readerState = { ...readerState, bookmarks: [...readerState.bookmarks, item] };
      return wireClone(item);
    },
    readerBookmarkDelete: async (id) => {
      readerState = { ...readerState, bookmarks: readerState.bookmarks.filter((bookmark) => bookmark.id !== id) };
    },
    noteCreate: async (chapterId, paragraphId, text, anchorStart, anchorEnd, anchorText) => {
      const paragraph = s.paragraphs.find((item) => item.id === paragraphId);
      if (!paragraph || paragraph.chapterId !== chapterId) throw new Error('Unknown manuscript paragraph');
      const note: ManuscriptNote = {
        id: `note-${s.nextId++}`,
        chapter: paragraph.chapter,
        chapterId,
        paragraph: paragraph.index,
        paragraphId,
        text,
        createdAt: new Date().toISOString(),
        anchorStart,
        anchorEnd,
        anchorText,
      };
      notes = [...notes, note];
      return wireClone(note);
    },
    noteDelete: async (id) => {
      notes = notes.filter((note) => note.id !== id);
    },
  } satisfies Partial<NarrationApi>;
  return { bindings, manuscriptReady };
}
