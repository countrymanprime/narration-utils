// Browser/mock API. It deliberately uses the same literal fixture data
// everywhere so visual review never silently exercises placeholder
// content instead of the screen we are trying to match.
import type {
  Bootstrap,
  ChapterStatus,
  GuideEntity,
  GuideEvidence,
  HostReady,
  ManuscriptNote,
  NarrationApi,
  ProjectAttachState,
  ReaderBookmark,
  ReaderState,
  RecentProject,
  Scope,
  ScopedSettingField,
  TracksDiscovery,
  TranscriptState,
  WorkJob,
  TtsCatalog,
  TtsInstallJob,
  WhisperCatalog,
  WhisperInstallJob,
} from '../types';
import { DESKTOP_HOST_API_VERSION } from '../hostApi';
import {
  aliceChapterSeeds,
  WIRE_CHAPTERS,
  WIRE_DISCREPANCIES,
  WIRE_ENTITIES,
  WIRE_LOGS,
  WIRE_NOTES,
  WIRE_PARAGRAPHS,
  withFormatting,
  WIRE_READER_STATE,
  WIRE_TRACKS_PROJECT,
  WIRE_TRANSCRIPT,
  wireClone,
  wireSettings,
} from './mockFixtures';
import { loadAliceManuscript } from './aliceManuscript';
import { createTeleprompterMock, type TeleprompterSeed } from './teleprompterMock';

const DEFAULT_PROJECT_FOLDER = 'C:/Projects/Alice-in-Wonderland';
const DEFAULT_PROJECT_NAME = 'Alice’s Adventures in Wonderland';

/** Mirrors the Go backend's `filepath.Base(path)` default-naming rule for a folder chosen with no explicit name. */
function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

const MOCK_AUDIO_SECONDS = 600;
let mockAudioUrl: string | undefined;

/**
 * Browser mock mode has no /media route, so play, skip, and the time readout
 * would have nothing to act on. This serves a real, silent WAV from memory
 * instead. It's built lazily and only where object URLs exist (not jsdom).
 */
function mockAudioSource(): string | undefined {
  if (typeof URL.createObjectURL !== 'function') return undefined;
  if (!mockAudioUrl) {
    const sampleRate = 8000;
    const dataBytes = sampleRate * MOCK_AUDIO_SECONDS;
    const wav = new Uint8Array(44 + dataBytes).fill(128); // unsigned 8-bit silence
    const view = new DataView(wav.buffer);
    const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, 'data');
    view.setUint32(40, dataBytes, true);
    mockAudioUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  }
  return mockAudioUrl;
}

export function createMockApi(
  overrides: Partial<NarrationApi> = {},
  // manuscriptCandidate boots a project with no imported manuscript but a
  // manuscript file waiting in its folder (Home offers to import it, ADR-0019).
  // teleprompter boots with a session already part-way through the first chapter.
  initial: {
    projectFolder?: string;
    tracksCandidates?: string[];
    noManuscript?: boolean;
    manuscriptCandidate?: { path: string; name: string };
    teleprompter?: TeleprompterSeed;
  } = {},
): NarrationApi {
  let entities = wireClone(WIRE_ENTITIES);
  let chapters = wireClone(WIRE_CHAPTERS);
  let paragraphs = wireClone(WIRE_PARAGRAPHS);
  let notes = wireClone(WIRE_NOTES);
  let readerState: ReaderState = wireClone(WIRE_READER_STATE);
  let hints: string[] = [];
  let projectFolder = initial.projectFolder ?? DEFAULT_PROJECT_FOLDER;
  let projectName = initial.projectFolder === undefined ? DEFAULT_PROJECT_NAME : basename(projectFolder);
  let daw = 'REAPER';
  // One candidate auto-selects (like the Go host); several leave the choice to the narrator.
  const tracksCandidates = initial.tracksCandidates ?? [WIRE_TRACKS_PROJECT.path];
  let tracksDiscovery: TracksDiscovery = { candidates: tracksCandidates, selected: tracksCandidates.length === 1 ? tracksCandidates[0] : '' };
  let recentProjects: RecentProject[] = [
    { path: 'C:/Projects/Alice-in-Wonderland', name: 'Alice’s Adventures in Wonderland', lastOpened: '2026-09-15T09:00:00Z' },
    { path: 'C:/Projects/Voltage-and-the-Undercroft', name: 'Voltage and the Undercroft', lastOpened: '2026-09-10T18:30:00Z' },
  ];
  const projectAttachSubscribers = new Set<(state: ProjectAttachState) => void>();
  const attachProject = (path: string, name?: string) => {
    projectFolder = path;
    projectName = name || basename(path);
    daw = 'Standalone';
    projectAttachSubscribers.forEach((fn) => fn({ attached: true }));
    return { switched: true };
  };
  const manuscriptReady = loadAliceManuscript(aliceChapterSeeds).then((loaded) => {
    if (!loaded) return;
    chapters = loaded.chapters;
    // The real text needs the same preserved formatting/line-break sample as
    // the seed fixture, so the reader shows both in either data source.
    paragraphs = loaded.paragraphs.map(withFormatting).map((paragraph) => ({
      ...paragraph,
      entityIds: entities
        .filter((entity) => [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)].some((term) => paragraph.text.includes(term)))
        .map((entity) => entity.id),
    }));
    // The host's chapter list carries each chapter's paragraph ids/indexes, which
    // "Go to line" deep links (#p<index>) use to find the owning chapter.
    chapters = chapters.map((chapter) => ({
      ...chapter,
      paragraphIds: paragraphs.filter((paragraph) => paragraph.chapterId === chapter.id).map(({ id, index }) => ({ id, index })),
    }));
    // WIRE_ENTITIES' occurrence paragraph numbers are computed against the
    // small local seed fixture, not the real manuscript text just loaded
    // above, so they'd point at the wrong line ("go to line" landing
    // nowhere near the actual occurrence) - recompute them against the
    // paragraphs that are now actually in the reader.
    const evidenceFor = (term: string): GuideEvidence[] =>
      paragraphs
        .filter((paragraph) => paragraph.text.includes(term))
        .map((paragraph) => ({ chapter: paragraph.chapter, paragraph: paragraph.index, sourceLine: paragraph.sourceLine, excerpt: paragraph.text }));
    entities = entities.map((entity) => {
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
  const vocabularyCandidates = Array.from(new Set(entities.flatMap((entity) => [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)])));
  let transcript: TranscriptState = wireClone(WIRE_TRANSCRIPT);
  let lastCompleted: TranscriptState = {
    ...wireClone(WIRE_TRANSCRIPT),
    phase: 'success',
    percent: 100,
    elapsed: 42,
    message: 'Comparison complete.',
    summary: `${WIRE_DISCREPANCIES.length} discrepancies found.`,
    logs: WIRE_LOGS.map((entry) => entry.text),
    rows: wireClone(WIRE_DISCREPANCIES),
    trackName: 'Chapter 1',
    audioItemCount: 3,
    completedAt: '2026-09-15T14:30:00Z',
  };
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
  let importJob: WorkJob = { id: null, kind: 'manuscript_import', phase: 'idle', message: 'Ready to import.', percent: 0, logs: [], elapsed: 0 };
  let storyBibleJob: WorkJob = { id: null, kind: 'story_bible', phase: 'idle', message: 'Ready to build.', percent: 0, logs: [], elapsed: 0 };
  let ttsInstalled = false;
  const mockVoice = {
    id: 'en_US-ljspeech-high',
    provider: 'piper',
    displayName: 'LJ Speech (U.S. English)',
    locale: 'en_US',
    version: '1.0.0',
    publisher: 'rhasspy',
    license: 'Public domain training data; Piper Voices repository MIT',
    licenseUrl: 'https://keithito.com/LJ-Speech-Dataset/',
    modelCardUrl: 'https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/en/en_US/ljspeech/high/MODEL_CARD',
    provenanceUrl: 'https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/en/en_US/ljspeech/high',
    attribution: 'LJ Speech Dataset (public domain); Piper voice model by rhasspy contributors.',
    downloadSize: 114203981,
    installState: 'not_installed' as const,
  };
  // Whisper defaults to already installed so existing setup/run flows are not
  // gated in every test; a dedicated scenario calls whisperRemove first to
  // exercise the asset_required prompt.
  let whisperInstalled = true;
  const mockWhisperModel = {
    id: 'small',
    provider: 'faster-whisper',
    displayName: 'Small',
    version: '536b0662742c02347bc0e980a01041f333bce120',
    publisher: 'Systran',
    license: 'MIT',
    licenseUrl: 'https://huggingface.co/Systran/faster-whisper-small',
    modelCardUrl: 'https://huggingface.co/Systran/faster-whisper-small',
    provenanceUrl: 'https://huggingface.co/Systran/faster-whisper-small',
    attribution: 'CTranslate2 conversion of OpenAI Whisper small, published by Systran.',
    downloadSize: 483546902 + 2370 + 2203239 + 459861,
    installState: 'not_installed' as const,
  };
  const teleprompter = createTeleprompterMock({
    ready: manuscriptReady,
    chapters: () => chapters,
    paragraphs: () => paragraphs,
    assetRequired: () =>
      whisperInstalled
        ? undefined
        : { status: 'asset_required', model: mockWhisperModel, installState: 'not_installed', downloadSize: mockWhisperModel.downloadSize },
    seed: initial.teleprompter,
  });
  const publish = () => {
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
          summary: `${WIRE_DISCREPANCIES.length} discrepancies found.`,
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
    ready: async () => ({ apiVersion: DESKTOP_HOST_API_VERSION, diagnosticId: 'mock' }) as HostReady,
    bootstrap: async () =>
      ({
        apiVersion: DESKTOP_HOST_API_VERSION,
        diagnosticId: 'mock',
        projectFolder,
        projectName,
        daw,
        manuscript:
          initial.noManuscript || initial.manuscriptCandidate
            ? null
            : {
                id: 'alice',
                format: 'docx',
                sourceName: 'Alice.docx',
                importedAt: '2026-01-01T00:00:00Z',
                narratableWordCount: 2672,
                narratableChapterCount: 3,
              },
        manuscriptCandidate: initial.manuscriptCandidate ?? null,
        runtime: {},
        transcript: wireClone(transcript),
      }) as Bootstrap,
    selectManuscript: async () => {
      importJob = {
        id: 'mock-import',
        kind: 'manuscript_import',
        phase: 'preparing',
        message: 'Manuscript selected. Choose import options to continue.',
        percent: 0,
        logs: ['Selected manuscript'],
        elapsed: 0,
        preview: { format: 'docx', sourceName: 'Alice.docx', paragraphCount: 240, chapterTitles: ['Chapter 1'] },
        requiresReset: false,
      };
      return { selected: true, jobId: 'mock-import' };
    },
    manuscriptBeginImport: async () => {
      importJob = {
        id: 'mock-import',
        kind: 'manuscript_import',
        phase: 'preparing',
        message: 'Manuscript selected. Choose import options to continue.',
        percent: 0,
        logs: ['Selected manuscript'],
        elapsed: 0,
        preview: { format: 'docx', sourceName: 'Alice.docx', paragraphCount: 240, chapterTitles: ['Chapter 1'] },
        requiresReset: false,
      };
      return { selected: true, jobId: 'mock-import' };
    },
    manuscriptImportState: async () => wireClone(importJob),
    manuscriptImportPreview: async (_jobId, { markdownHeadingLevel }) => {
      importJob = {
        ...importJob,
        phase: 'ready',
        percent: 100,
        message: 'Import preview is ready.',
        // Mirrors the host's staged import log (shell/internal/importer).
        logs: [
          ...importJob.logs,
          `Reading document structure using H${markdownHeadingLevel} chapter headings`,
          'Read 240 paragraphs, 12 of them headings',
          'Classifying front matter, chapters and reference sections',
          'Preview ready: 240 paragraphs, 3 chapters, 0 character suggestions',
        ],
      };
      return wireClone(importJob);
    },
    manuscriptImportCommit: async () => {
      importJob = {
        ...importJob,
        phase: 'success',
        percent: 100,
        message: 'Manuscript import complete.',
        logs: [...importJob.logs, 'Copying Alice.docx (48 KB) into the project and computing its checksum', 'Writing manuscript.json', 'Manuscript imported'],
        result: { id: 'alice', format: 'docx', sourceName: 'Alice.docx', importedAt: '2026-01-01T00:00:00Z' },
      };
      return wireClone(importJob);
    },
    manuscriptImportCancel: async () => {
      importJob = { ...importJob, phase: 'cancelled', message: 'Manuscript import cancelled.' };
    },
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
    guideBuild: async () => {
      storyBibleJob = {
        id: 'mock-guide',
        kind: 'story_bible',
        phase: 'success',
        message: 'Story Bible rebuild complete.',
        percent: 100,
        logs: ['Reading canonical manuscript', 'Built Story Bible with 7 entities'],
        elapsed: 1,
        result: { message: 'Story Bible rebuilt.' },
      };
      return wireClone(storyBibleJob);
    },
    guideBuildState: async () => wireClone(storyBibleJob),
    clearProjectData: async () => {},
    guideEntities: async () => {
      await manuscriptReady;
      return wireClone(entities);
    },
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
    guidePreview: async () =>
      ttsInstalled
        ? { status: 'ready' as const, audioBase64: '', mimeType: 'audio/wav' }
        : { status: 'asset_required' as const, voice: mockVoice, installState: 'not_installed' as const, downloadSize: mockVoice.downloadSize },
    ttsCatalog: async () =>
      ({
        catalogVersion: 1,
        provider: { id: 'piper', effectiveSource: 'repo_default' },
        voice: { id: mockVoice.id, effectiveSource: 'repo_default' },
        voices: [{ ...mockVoice, installState: ttsInstalled ? 'installed' : 'not_installed' }],
      }) as TtsCatalog,
    ttsInstall: async (voiceId) => {
      if (voiceId !== mockVoice.id) throw new Error('Unknown approved TTS voice.');
      ttsInstalled = true;
      return { id: null, voiceId, phase: 'success', percent: 100, message: 'Voice installed and verified.', error: '' } as TtsInstallJob;
    },
    ttsInstallState: async (jobId) => ({
      id: jobId,
      voiceId: mockVoice.id,
      phase: 'success',
      percent: 100,
      message: 'Voice installed and verified.',
      error: '',
    }),
    ttsInstallCancel: async (jobId) => ({ id: jobId, voiceId: mockVoice.id, phase: 'cancelled', percent: 0, message: 'Voice download cancelled.', error: '' }),
    ttsRemove: async (voiceId) => {
      if (voiceId === mockVoice.id) ttsInstalled = false;
    },
    whisperCatalog: async () =>
      ({
        catalogVersion: 1,
        model: { id: mockWhisperModel.id, effectiveSource: 'repo_default' },
        models: [{ ...mockWhisperModel, installState: whisperInstalled ? 'installed' : 'not_installed' }],
      }) as WhisperCatalog,
    whisperInstall: async (modelId) => {
      if (modelId !== mockWhisperModel.id) throw new Error('Unknown approved Whisper model.');
      whisperInstalled = true;
      return { id: null, modelId, phase: 'success', message: 'Whisper model installed and verified.' } as WhisperInstallJob;
    },
    whisperInstallState: async (jobId) => ({ id: jobId, modelId: mockWhisperModel.id, phase: 'success', message: 'Whisper model installed and verified.' }),
    whisperInstallCancel: async (jobId) => ({ id: jobId, modelId: mockWhisperModel.id, phase: 'cancelled', message: 'Whisper model download cancelled.' }),
    whisperRemove: async (modelId) => {
      if (modelId === mockWhisperModel.id) whisperInstalled = false;
    },
    transcriptStart: async () =>
      whisperInstalled
        ? (startRun(), { status: 'started' as const })
        : { status: 'asset_required' as const, model: mockWhisperModel, installState: 'not_installed' as const, downloadSize: mockWhisperModel.downloadSize },
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
    transcriptExportMarkers: async () => {
      const exportable = transcript.rows.filter((row) => (row.markerState ?? 'pending') === 'pending');
      transcript = {
        ...transcript,
        markerExport: {
          phase: 'exporting',
          message: `Exporting ${exportable.length} marker${exportable.length === 1 ? '' : 's'} to REAPER…`,
          added: 0,
          skipped: 0,
        },
      };
      publish();
      setTimeout(() => {
        const added = transcript.rows.filter((row) => (row.markerState ?? 'pending') === 'pending').length;
        transcript = {
          ...transcript,
          rows: transcript.rows.map((row) => ((row.markerState ?? 'pending') === 'pending' ? { ...row, markerState: 'exported' } : row)),
          markerExport: {
            phase: 'complete',
            message: `Exported ${added} marker${added === 1 ? '' : 's'}; skipped ${transcript.rows.length - added} existing.`,
            added,
            skipped: transcript.rows.length - added,
          },
        };
        lastCompleted = wireClone(transcript);
        publish();
      }, 250);
    },
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
      return wireClone(paragraphs.filter((paragraph) => paragraph.chapterId === chapter || paragraph.chapter === chapter));
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
      const found = chapters.find((item) => item.id === chapter || item.title === chapter);
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
    noteCreate: async (chapterId, paragraphId, text, anchorStart, anchorEnd, anchorText) => {
      const paragraph = paragraphs.find((item) => item.id === paragraphId);
      if (!paragraph || paragraph.chapterId !== chapterId) throw new Error('Unknown manuscript paragraph');
      const note: ManuscriptNote = {
        id: `note-${nextId++}`,
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
    subscribeTranscript: (onUpdate) => {
      subscribers.add(onUpdate);
      onUpdate(wireClone(transcript));
      return () => subscribers.delete(onUpdate);
    },
    subscribeProjectAttach: (onUpdate) => {
      projectAttachSubscribers.add(onUpdate);
      return () => projectAttachSubscribers.delete(onUpdate);
    },
    projectRecents: async () => wireClone(recentProjects),
    selectProjectFolder: async () => ({ selected: true, path: 'C:/Projects/Mock-Project' }),
    switchProject: async (path, name) => attachProject(path, name),
    createProject: async (path, name) => attachProject(path, name),
    removeRecentProject: async (path) => {
      recentProjects = recentProjects.filter((entry) => entry.path.toLowerCase() !== path.toLowerCase());
      return wireClone(recentProjects);
    },
    tracksDiscover: async () => wireClone(tracksDiscovery),
    tracksSelect: async (path) => {
      tracksDiscovery = { ...tracksDiscovery, selected: path };
      return wireClone(tracksDiscovery);
    },
    tracksList: async () => wireClone(WIRE_TRACKS_PROJECT),
    ...teleprompter,
    mediaUrl: (sourceFile) => mockAudioSource() ?? sourceFile,
  };
  return { ...base, ...overrides };
}
