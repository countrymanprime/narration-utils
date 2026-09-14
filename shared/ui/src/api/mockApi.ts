// Browser/mock API. It deliberately uses the same literal fixture data
// everywhere so visual review never silently exercises placeholder
// content instead of the screen we are trying to match.
import type {
  Bootstrap,
  ChapterStatus,
  GuideEntity,
  HostReady,
  ManuscriptNote,
  NarrationApi,
  ReaderBookmark,
  ReaderState,
  Scope,
  ScopedSettingField,
  TranscriptState,
} from '../types';
import {
  aliceChapterSeeds,
  WIRE_CHAPTERS,
  WIRE_DISCREPANCIES,
  WIRE_ENTITIES,
  WIRE_LOGS,
  WIRE_NOTES,
  WIRE_PARAGRAPHS,
  WIRE_READER_STATE,
  WIRE_TRANSCRIPT,
  wireClone,
  wireSettings,
} from './mockFixtures';
import { loadAliceManuscript } from './aliceManuscript';

export function createMockApi(overrides: Partial<NarrationApi> = {}): NarrationApi {
  let entities = wireClone(WIRE_ENTITIES);
  let chapters = wireClone(WIRE_CHAPTERS);
  let paragraphs = wireClone(WIRE_PARAGRAPHS);
  let notes = wireClone(WIRE_NOTES);
  let readerState: ReaderState = wireClone(WIRE_READER_STATE);
  let hints: string[] = [];
  const manuscriptReady = loadAliceManuscript(aliceChapterSeeds).then((loaded) => {
    if (!loaded) return;
    chapters = loaded.chapters;
    paragraphs = loaded.paragraphs.map((paragraph) => ({
      ...paragraph,
      entityIds: entities
        .filter((entity) => [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)].some((term) => paragraph.text.includes(term)))
        .map((entity) => entity.id),
    }));
  });
  const vocabularyCandidates = Array.from(new Set(entities.flatMap((entity) => [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)])));
  let transcript: TranscriptState = wireClone(WIRE_TRANSCRIPT);
  let lastCompleted: TranscriptState = {
    ...wireClone(WIRE_TRANSCRIPT),
    phase: 'success',
    percent: 100,
    elapsed: 42,
    message: 'Comparison complete.',
    summary: '2 discrepancies found.',
    logs: WIRE_LOGS.map((entry) => entry.text),
    rows: wireClone(WIRE_DISCREPANCIES),
  };
  let revision = 1;
  const globalSettings = wireSettings();
  const settings: Record<Scope, Record<string, ScopedSettingField[]>> = {
    global: globalSettings,
    project: Object.fromEntries(
      Object.entries(globalSettings).map(([tool, fields]) => [
        tool,
        fields.map((field) => ({ ...field, value: '', isSet: false, effectiveValue: field.value, effectiveSource: 'Global' })),
      ]),
    ),
  };
  const subscribers = new Set<(state: TranscriptState) => void>();
  let nextId = 1;
  let runTimers: ReturnType<typeof setTimeout>[] = [];
  const publish = () => {
    revision += 1;
    subscribers.forEach((fn) => fn(wireClone(transcript)));
  };
  const stopRun = () => {
    runTimers.forEach(clearTimeout);
    runTimers = [];
  };
  const updateEntity = (id: string, change: (entity: GuideEntity) => GuideEntity) => {
    entities = entities.map((entity) => (entity.id === id ? change(entity) : entity));
  };
  const startRun = () => {
    stopRun();
    transcript = { ...wireClone(WIRE_TRANSCRIPT), phase: 'running', percent: 8, elapsed: 4, message: 'Transcribing chunk 1 of 7…', logs: [] };
    publish();
    WIRE_LOGS.forEach((entry, index) =>
      runTimers.push(
        setTimeout(
          () => {
            if (transcript.phase !== 'running') return;
            transcript = {
              ...transcript,
              percent: Math.min(90, 18 + index * 13),
              elapsed: Math.min(42, 9 + index * 6),
              message: `Transcribing chunk ${Math.min(7, index + 2)} of 7…`,
              logs: [...transcript.logs, entry.text],
            };
            publish();
          },
          380 * (index + 1),
        ),
      ),
    );
    runTimers.push(
      setTimeout(() => {
        if (transcript.phase !== 'running') return;
        transcript = {
          ...wireClone(WIRE_TRANSCRIPT),
          phase: 'success',
          percent: 100,
          elapsed: 42,
          message: 'Comparison complete.',
          summary: '2 discrepancies found.',
          logs: WIRE_LOGS.map((entry) => entry.text),
          rows: wireClone(WIRE_DISCREPANCIES),
        };
        lastCompleted = wireClone(transcript);
        publish();
        stopRun();
      }, 2_600),
    );
  };
  const base: NarrationApi = {
    ready: async () => ({ apiVersion: 1, diagnosticId: 'mock' }) as HostReady,
    bootstrap: async () =>
      ({
        apiVersion: 1,
        diagnosticId: 'mock',
        projectFolder: 'C:/Projects/Alice-in-Wonderland',
        projectName: 'Alice’s Adventures in Wonderland',
        daw: 'REAPER',
        manuscriptPath: 'C:/Projects/Alice-in-Wonderland/Manuscript.docx',
        runtime: {},
        transcript: wireClone(transcript),
      }) as Bootstrap,
    poll: async () => ({ revision, transcript: wireClone(transcript) }),
    selectManuscript: async () => ({ path: 'C:/Projects/Alice-in-Wonderland/Manuscript.docx' }),
    saveSettings: async (tool, scope, values) => {
      settings[scope][tool] = (settings[scope][tool] || []).map((field) =>
        field.key in values
          ? {
              ...field,
              value: values[field.key] ?? '',
              isSet: values[field.key] !== null,
              effectiveValue: values[field.key] ?? settings.global[tool]?.find((item) => item.key === field.key)?.effectiveValue ?? '',
            }
          : field,
      );
      return base.bootstrap();
    },
    settingsForScope: async (scope) => wireClone(settings[scope]),
    guideBuild: async () => 'Story Bible refreshed — 1 entry needs review.',
    guideEntities: async () => wireClone(entities),
    guideEdit: async (id, values) =>
      updateEntity(id, (entity) => ({
        ...entity,
        canonical_name: values.canonical_name ?? entity.canonical_name,
        category: values.category ?? entity.category,
        description: values.description === undefined ? entity.description : { text: values.description, evidence: {} },
        personality_notes: values.personality === undefined ? entity.personality_notes : values.personality ? [{ text: values.personality, evidence: {} }] : [],
        context: values.context ?? entity.context,
        aliases:
          values.aliases === undefined
            ? entity.aliases
            : values.aliases
                .split(';')
                .map((text) => text.trim())
                .filter(Boolean)
                .map(
                  (text) =>
                    entity.aliases.find((alias) => alias.text === text) ?? {
                      text,
                      pronunciation: { ipa: '', source: 'Piper', confidence: 'pending' },
                      occurrences: [],
                    },
                ),
      })),
    guideSetLocked: async (id, locked) => updateEntity(id, (entity) => ({ ...entity, locked })),
    guideRescan: async (id) =>
      updateEntity(id, (entity) => ({
        ...entity,
        aliases: entity.aliases.map((alias) =>
          alias.occurrences.length
            ? alias
            : {
                ...alias,
                pronunciation: { ipa: '/generated/', source: 'Piper', confidence: 'generated' },
                occurrences: [{ chapter: 'Chapter 2', paragraph: 1, sourceLine: 17, excerpt: `Found a mention of ${alias.text} while scanning Chapter 2.` }],
              },
        ),
        occurrence_count: entity.occurrences.length + entity.aliases.reduce((sum, alias) => sum + (alias.occurrences.length || 1), 0),
      })),
    guideCreate: async (name, category, aliases) => {
      const id = `new-${nextId++}`;
      entities = [
        ...entities,
        {
          id,
          canonical_name: name || 'New entity',
          category: category || 'Draft',
          locked: false,
          review_state: 'draft',
          pronunciation: { ipa: '', source: 'Piper', confidence: 'pending' },
          description: { text: '', evidence: {} },
          personality_notes: [],
          context: '',
          aliases: aliases.map((text) => ({ text, pronunciation: { ipa: '', source: 'Piper', confidence: 'pending' }, occurrences: [] })),
          relationships: [],
          occurrences: [],
          occurrence_count: 0,
        },
      ];
      return id;
    },
    guideMerge: async (sourceId, targetId) => {
      const source = entities.find((entity) => entity.id === sourceId);
      const target = entities.find((entity) => entity.id === targetId);
      if (!source || !target || source.locked) return;
      const names = [{ text: source.canonical_name, pronunciation: source.pronunciation, occurrences: source.occurrences }, ...source.aliases];
      const aliases = [...target.aliases];
      names.forEach((candidate) => {
        if (
          candidate.text.toLowerCase() !== target.canonical_name.toLowerCase() &&
          !aliases.some((alias) => alias.text.toLowerCase() === candidate.text.toLowerCase())
        )
          aliases.push(candidate);
      });
      updateEntity(targetId, (entity) => ({
        ...entity,
        aliases,
        occurrences: [...entity.occurrences, ...source.occurrences],
        relationships: [...entity.relationships, ...source.relationships.filter((relationship) => relationship.id !== targetId)],
      }));
      entities = entities
        .filter((entity) => entity.id !== sourceId)
        .map((entity) => ({
          ...entity,
          relationships: entity.relationships
            .map((relationship) => (relationship.id === sourceId ? { ...relationship, id: targetId, name: target.canonical_name } : relationship))
            .filter((relationship, index, rows) => rows.findIndex((item) => item.id === relationship.id && item.label === relationship.label) === index),
        }));
    },
    guideDelete: async (id) => {
      entities = entities
        .filter((entity) => entity.id !== id)
        .map((entity) => ({ ...entity, relationships: entity.relationships.filter((relationship) => relationship.id !== id) }));
    },
    guideRelate: async (id, otherId, label) =>
      updateEntity(id, (entity) => ({
        ...entity,
        relationships: entity.relationships.some((relationship) => relationship.id === otherId && relationship.label === label)
          ? entity.relationships
          : [...entity.relationships, { id: otherId, name: entities.find((row) => row.id === otherId)?.canonical_name ?? otherId, label }],
      })),
    guideUnrelate: async (id, otherId, label) =>
      updateEntity(id, (entity) => ({
        ...entity,
        relationships: entity.relationships.filter((relationship) => !(relationship.id === otherId && relationship.label === label)),
      })),
    guideExport: async () => 'C:/Projects/Voltage-and-the-Undercroft/TranscriptCompare/hotwords.txt',
    guidePreview: async () => '',
    transcriptStart: async () => startRun(),
    transcriptCancel: async () => {
      stopRun();
      transcript = { ...transcript, phase: 'cancelled', message: 'Comparison cancelled' };
      publish();
    },
    transcriptReset: async () => {
      stopRun();
      transcript = wireClone(WIRE_TRANSCRIPT);
      publish();
    },
    transcriptLastCompleted: async () => wireClone(lastCompleted),
    transcriptAddEquivalence: async () => 'Added pronunciation equivalence.',
    transcriptJump: async () => {},
    transcriptSuggestHints: async () =>
      vocabularyCandidates
        .filter((candidate) => !hints.some((accepted) => accepted.localeCompare(candidate, undefined, { sensitivity: 'accent' }) === 0))
        .join(', '),
    transcriptHints: async () => [...hints],
    transcriptSaveHints: async (accepted) => {
      hints = [...accepted];
    },
    reportClientDiagnostic: async () => {},
    manuscriptChapters: async () => {
      await manuscriptReady;
      return wireClone(chapters);
    },
    manuscriptParagraphs: async (chapter) => {
      await manuscriptReady;
      return wireClone(paragraphs.filter((paragraph) => paragraph.chapter === chapter));
    },
    manuscriptSearch: async (query) => {
      await manuscriptReady;
      return wireClone(
        paragraphs
          .filter((paragraph) => paragraph.text.toLowerCase().includes(query.toLowerCase()))
          .map((paragraph) => ({ chapter: paragraph.chapter, paragraph: paragraph.index, sourceLine: paragraph.sourceLine, excerpt: paragraph.text })),
      );
    },
    manuscriptSetChapterStatus: async (chapter, status) => {
      await manuscriptReady;
      const found = chapters.find((item) => item.title === chapter);
      if (!found) throw new Error(`Unknown chapter: ${chapter}`);
      found.status = status as ChapterStatus;
      return wireClone(found);
    },
    noteList: async (chapter) => wireClone(chapter ? notes.filter((note) => note.chapter === chapter) : notes),
    manuscriptReader: async () => {
      await manuscriptReady;
      return { chapters: wireClone(chapters), paragraphs: wireClone(paragraphs), notes: wireClone(notes) };
    },
    readerState: async () => wireClone(readerState),
    readerStateSave: async (values) => {
      readerState = { ...readerState, ...values };
      return wireClone(readerState);
    },
    readerBookmarkCreate: async (bookmark) => {
      const item: ReaderBookmark = { ...bookmark, id: `bookmark-${nextId++}`, createdAt: new Date().toISOString() };
      readerState = { ...readerState, bookmarks: [...readerState.bookmarks, item] };
      return wireClone(item);
    },
    readerBookmarkDelete: async (id) => {
      readerState = { ...readerState, bookmarks: readerState.bookmarks.filter((bookmark) => bookmark.id !== id) };
    },
    noteCreate: async (chapter, paragraph, text, anchorStart, anchorEnd, anchorText) => {
      const note: ManuscriptNote = {
        id: `note-${nextId++}`,
        chapter,
        paragraph,
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
    subscribeTranscript: (onUpdate) => {
      subscribers.add(onUpdate);
      onUpdate(wireClone(transcript));
      return () => subscribers.delete(onUpdate);
    },
  };
  return { ...base, ...overrides };
}
