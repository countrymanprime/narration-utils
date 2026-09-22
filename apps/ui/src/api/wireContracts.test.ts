import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { DESKTOP_HOST_API_VERSION } from '../hostApi';
import { createMockApi } from './mockApi';
import { WIRE_TRANSCRIPT } from './mockFixtures';
import {
  bookmarkSchema,
  chapterSchema,
  chaptersSchema,
  fileSelectionSchema,
  noteSchema,
  notesSchema,
  paragraphsSchema,
  readerSchema,
  readerStateSchema,
  searchHitsSchema,
  workJobSchema,
} from './schemas/manuscript';
import { assetCatalogSchema, assetInstallJobSchema, assetVerifyResultSchema } from './schemas/assets';
import { settingsForScopeSchema } from './schemas/settings';
import { tracksDiscoverySchema, tracksProjectSchema } from './schemas/tracks';
import { ttsCatalogSchema, ttsInstallJobSchema } from './schemas/tts';
import { updateJobSchema, updateStatusSchema } from './schemas/update';
import { startResultSchema, whisperCatalogSchema, whisperInstallJobSchema } from './schemas/whisper';
import { projectFolderSelectionSchema, projectSwitchResultSchema, recentProjectsSchema } from './schemas/project';
import { guideBuildResultSchema, guideCreatedSchema, guideEntitiesSchema, guidePreviewSchema } from './schemas/storyBible';
import { bootstrapSchema, jobEndedSchema, noticeSchema, projectAttachStateSchema, readySchema } from './schemas/system';
import { teleprompterEventSchema, teleprompterStateSchema } from './schemas/teleprompter';
import { equivalenceSchema, hintSuggestionsSchema, hintsSchema, lastCompletedSchema, transcriptStateSchema } from './schemas/transcript';
import { unknownKeys } from './schemas/strictness';
import { parseWire, type WireContext } from './wire/parseWire';
import { WireError } from './wire/WireError';

// ADR 0069, rule 4: the fixtures are the contract. Every payload the Go host and the Python sidecars write to
// tests/fixtures/contracts/ is validated here by the same schemas the app runs, and so is every answer the mock client gives;
// both are also checked strictly, so a key the schema does not declare fails here even though the app itself would ignore it.
const GOLDEN_DIR = fileURLToPath(new URL('../../../../tests/fixtures/contracts/', import.meta.url));
const ctx = (payload: string): WireContext => ({ boundary: 'contract.test', payload });

/** Validates `value`, and fails on any key the schema does not declare. */
function expectMatches(schema: z.ZodType, value: unknown, payload: string): void {
  parseWire(schema, value, ctx(payload));
  expect(unknownKeys(schema, value), `${payload} has keys its schema does not declare`).toEqual([]);
}

// One row per committed file: which schema owns it. A new file with no row fails the first test below.
const GOLDEN: Record<string, z.ZodType> = {
  'bootstrap-manuscript.json': bootstrapSchema,
  'bootstrap-candidate.json': bootstrapSchema,
  'bootstrap-standalone.json': bootstrapSchema,
  'transcript-idle.json': transcriptStateSchema,
  'transcript-success.json': transcriptStateSchema,
  'teleprompter-state-idle.json': teleprompterStateSchema,
  'teleprompter-state-running.json': teleprompterStateSchema,
  'teleprompter-events.json': teleprompterEventSchema.array(),
  'manuscript-import-selected.json': workJobSchema,
  'manuscript-import-preview.json': workJobSchema,
  'manuscript-import-success.json': workJobSchema,
  'manuscript-chapters.json': chaptersSchema,
  'manuscript-chapter-status.json': chapterSchema,
  'manuscript-paragraphs.json': paragraphsSchema,
  'manuscript-search.json': searchHitsSchema,
  'manuscript-note.json': noteSchema,
  'manuscript-notes.json': notesSchema,
  'manuscript-notes-empty.json': notesSchema,
  'manuscript-bookmark.json': bookmarkSchema,
  'manuscript-reader-state.json': readerStateSchema,
  'manuscript-reader-state-empty.json': readerStateSchema,
  'manuscript-reader.json': readerSchema,
  'guide-entities-sidecar.json': guideEntitiesSchema,
  'guide-entities.json': guideEntitiesSchema,
  'guide-entities-legacy.json': guideEntitiesSchema,
  'guide-entities-empty.json': guideEntitiesSchema,
  'guide-build-idle.json': workJobSchema,
  'guide-build-starting.json': workJobSchema,
  'guide-build-failed.json': workJobSchema,
  'guide-build-started.json': guideBuildResultSchema,
  'guide-build-asset-required.json': guideBuildResultSchema,
  'guide-preview-asset-required.json': guidePreviewSchema,
  'project-recents.json': recentProjectsSchema,
  'project-recents-empty.json': recentProjectsSchema,
  'project-switch-attached.json': projectSwitchResultSchema,
  'project-switch-refused.json': projectSwitchResultSchema,
  'system-notice.json': noticeSchema,
  'job-ended-success.json': jobEndedSchema,
  'job-ended-error.json': jobEndedSchema,
  'tts-catalog.json': ttsCatalogSchema,
  'tts-install-downloading.json': ttsInstallJobSchema,
  'tts-install-success.json': ttsInstallJobSchema,
  'tts-install-error.json': ttsInstallJobSchema,
  'tts-install-cancelled.json': ttsInstallJobSchema,
  'asset-install-downloading.json': assetInstallJobSchema,
  'assets-list.json': assetCatalogSchema,
  'assets-verify.json': assetVerifyResultSchema,
  'whisper-catalog.json': whisperCatalogSchema,
  'whisper-install-downloading.json': whisperInstallJobSchema,
  'tts-install-verifying.json': ttsInstallJobSchema,
  'whisper-install-success.json': whisperInstallJobSchema,
  'transcript-start-asset-required.json': startResultSchema,
  'transcript-start-started.json': startResultSchema,
  'settings-global.json': settingsForScopeSchema,
  'settings-project.json': settingsForScopeSchema,
  'update-status-unchecked.json': updateStatusSchema,
  'update-status-available.json': updateStatusSchema,
  'update-status-check-failed.json': updateStatusSchema,
  'update-status-development.json': updateStatusSchema,
  'update-status-downloaded.json': updateStatusSchema,
  'update-job-downloading.json': updateJobSchema,
  'update-job-verifying.json': updateJobSchema,
  'update-job-ready.json': updateJobSchema,
  'update-job-installing.json': updateJobSchema,
  'update-job-error.json': updateJobSchema,
  'update-job-cancelled.json': updateJobSchema,
  'tracks-project.json': tracksProjectSchema,
  'tracks-discovery-none.json': tracksDiscoverySchema,
  'tracks-discovery-several.json': tracksDiscoverySchema,
  'tracks-discovery-selected.json': tracksDiscoverySchema,
};

const readGolden = (file: string): unknown => JSON.parse(readFileSync(`${GOLDEN_DIR}${file}`, 'utf8'));

describe('golden payloads written by the Go host and the Python sidecars', () => {
  it('every committed file has a schema, and every schema row has a file', () => {
    const committed = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort();
    expect(committed).toEqual(Object.keys(GOLDEN).sort());
  });

  it.each(Object.entries(GOLDEN))('%s matches its schema and declares nothing the schema lacks', (file, schema) => {
    expectMatches(schema, readGolden(file), file);
  });

  it('the golden Bootstrap carries the API version this UI is built for', () => {
    expect(parseWire(bootstrapSchema, readGolden('bootstrap-manuscript.json'), ctx('bootstrap')).apiVersion).toBe(DESKTOP_HOST_API_VERSION);
  });

  it('the golden completed run keeps its rows and marker states through the schema', () => {
    const state = parseWire(transcriptStateSchema, readGolden('transcript-success.json'), ctx('transcript'));
    expect(state.rows.map((row) => row.markerState)).toEqual(['pending', 'existing']);
    expect(state.runId).toBe('1789000000000000');
  });
});

describe('answers of the mock client (it must pass the schemas the real host answers are held to)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ready and the default bootstrap', async () => {
    const api = createMockApi();
    expectMatches(readySchema, await api.ready(), 'mock ready');
    expectMatches(bootstrapSchema, await api.bootstrap(), 'mock bootstrap');
  });

  it.each([
    ['a project with no manuscript', { noManuscript: true }],
    ['a project offering a manuscript file', { manuscriptCandidate: { path: 'C:/Projects/Alice/manuscript.docx', name: 'manuscript.docx' } }],
    ['a standalone launch with no project', { projectFolder: '' }],
  ])('bootstrap for %s', async (_name, initial) => {
    expectMatches(bootstrapSchema, await createMockApi({}, initial).bootstrap(), 'mock bootstrap');
  });

  it('the fixture transcript state', () => {
    expectMatches(transcriptStateSchema, WIRE_TRANSCRIPT, 'WIRE_TRANSCRIPT');
  });

  it('the transcript state through a whole comparison run, including marker export', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const seen: unknown[] = [];
    api.subscribeTranscript((state) => seen.push(structuredClone(state)));
    await expect(api.transcriptStart({ model: 'small', chunk: '60', workers: '1', hints: '' })).resolves.toEqual({ status: 'started' });
    await vi.advanceTimersByTimeAsync(60_000);
    await api.transcriptExportMarkers();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen.length).toBeGreaterThan(3);
    for (const state of seen) expectMatches(transcriptStateSchema, state, 'mock transcript state');
    expect(new Set(seen.map((state) => (state as { phase: string }).phase)).size).toBeGreaterThan(2);
  });

  it('the teleprompter state and events through a session, from idle to stopped', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const events: unknown[] = [];
    const states: unknown[] = [];
    api.subscribeTeleprompterEvent((event) => events.push(event));
    api.subscribeTeleprompterState((state) => states.push(state));
    expectMatches(teleprompterStateSchema, await api.teleprompterState(), 'mock teleprompter idle');
    const chapter = (await api.manuscriptChapters())[0];
    await api.teleprompterStart({ chapter: chapter?.id ?? '', device: 'Microphone' });
    await vi.advanceTimersByTimeAsync(120_000);
    await api.teleprompterStop();
    expect(new Set(events.map((event) => (event as { type: string }).type))).toEqual(new Set(['script', 'partial', 'position']));
    for (const event of events) expectMatches(teleprompterEventSchema, event, 'mock teleprompter event');
    for (const state of states) expectMatches(teleprompterStateSchema, state, 'mock teleprompter state');
  });

  it.each(['listening', 'waiting', 'done'] as const)('a teleprompter session the host kept running (%s)', async (seed) => {
    const api = createMockApi({}, { teleprompter: seed });
    const state = await api.teleprompterState();
    expect(state.position?.status).toBe(seed);
    expectMatches(teleprompterStateSchema, state, `mock teleprompter ${seed}`);
  });

  it('the project-attach event', () => {
    const attached: unknown[] = [];
    const api = createMockApi();
    api.subscribeProjectAttach((state) => attached.push(state));
    void api.switchProject('C:/Projects/Other', 'Other');
    expect(attached).toHaveLength(1);
    expectMatches(projectAttachStateSchema, attached[0], 'mock system:attached');
  });
});

describe('answers of the mock client for the manuscript, Story Bible and project bindings', () => {
  it('the reader, its chapters, paragraphs, notes, search and saved state', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    expectMatches(chaptersSchema, chapters, 'mock chapters');
    expectMatches(readerSchema, await api.manuscriptReader(), 'mock reader');
    expectMatches(readerStateSchema, await api.readerState(), 'mock reader state');
    expectMatches(paragraphsSchema, await api.manuscriptParagraphs(chapters[0]?.id ?? ''), 'mock paragraphs');
    expectMatches(searchHitsSchema, await api.manuscriptSearch('alice'), 'mock search');
    expectMatches(notesSchema, await api.noteList(), 'mock notes');
    expectMatches(
      readerStateSchema,
      await api.readerStateSave({ activeChapter: chapters[0]?.id, activeSourceLine: 3, expandedChapters: [] }),
      'mock saved state',
    );
    expectMatches(chapterSchema, await api.manuscriptSetChapterStatus(chapters[0]?.id ?? '', 'recording'), 'mock chapter status');
  });

  it('a created note and bookmark', async () => {
    const api = createMockApi();
    const chapter = (await api.manuscriptChapters())[0];
    const paragraph = (await api.manuscriptParagraphs(chapter?.id ?? ''))[0];
    expectMatches(noteSchema, await api.noteCreate(chapter?.id ?? '', paragraph?.id ?? '', 'A note', 0, 4, 'Alic'), 'mock note');
    expectMatches(
      bookmarkSchema,
      await api.readerBookmarkCreate({
        kind: 'line',
        chapter: chapter?.title ?? '',
        chapterId: chapter?.id,
        paragraphId: paragraph?.id,
        paragraph: paragraph?.index,
      }),
      'mock bookmark',
    );
  });

  it('the manuscript import jobs from file selection to a committed import', async () => {
    const api = createMockApi();
    const selection = await api.selectManuscript();
    expectMatches(fileSelectionSchema, selection, 'mock file selection');
    const jobId = selection.jobId ?? '';
    expectMatches(workJobSchema, await api.manuscriptImportState(jobId), 'mock import state');
    expectMatches(workJobSchema, await api.manuscriptImportPreview(jobId, { markdownHeadingLevel: 1 }), 'mock import preview');
    expectMatches(workJobSchema, await api.manuscriptImportCommit(jobId, { confirmedReset: true }), 'mock import commit');
  });

  it.each(['docx', 'markdown'] as const)(
    'the %s import preview the review dialog is built on, sections of every kind and character suggestions',
    async (kind) => {
      const api = createMockApi({}, { importPreview: kind });
      const jobId = (await api.selectManuscript()).jobId ?? '';
      const job = await api.manuscriptImportPreview(jobId, { markdownHeadingLevel: 1 });
      expectMatches(workJobSchema, job, `mock ${kind} import preview`);
      expect(job.preview?.format).toBe(kind);
      expect(new Set(job.preview?.sections?.map((section) => section.contentKind))).toEqual(new Set(['narration', 'opening', 'reference']));
      expect(job.preview?.characterCandidates).toHaveLength(3);
      expectMatches(workJobSchema, await api.manuscriptImportCommit(jobId, { confirmedReset: false }), `mock ${kind} import commit`);
    },
  );

  it('the Story Bible entities, build job, created id and preview answers', async () => {
    const api = createMockApi();
    expectMatches(guideEntitiesSchema, await api.guideEntities(), 'mock entities');
    expectMatches(workJobSchema, await api.guideBuildState(), 'mock guide state');
    expectMatches(guideBuildResultSchema, await api.guideBuild(), 'mock guide build');
    expectMatches(guideBuildResultSchema, await api.guideBuild({ rulesOnly: true }), 'mock guide build, rules-only');
    expectMatches(guideBuildResultSchema, await createMockApi({}, { assets: 'downloading' }).guideBuild(), 'mock guide build, asking for the language model');
    expectMatches(guideCreatedSchema, { id: await api.guideCreate('New', 'Character', []) }, 'mock guide create');
    const entity = (await api.guideEntities())[0];
    expectMatches(guidePreviewSchema, await api.guidePreview(entity?.id ?? ''), 'mock preview');
  });

  it('the project picker answers', async () => {
    const api = createMockApi({}, { projectFolder: '' });
    expectMatches(recentProjectsSchema, await api.projectRecents(), 'mock recents');
    expectMatches(recentProjectsSchema, await api.removeRecentProject('C:/Projects/Voltage-and-the-Undercroft'), 'mock recents after remove');
    expectMatches(projectFolderSelectionSchema, await api.selectProjectFolder(), 'mock folder selection');
    expectMatches(projectSwitchResultSchema, await api.switchProject('C:/Projects/Other', 'Other'), 'mock switch');
    expectMatches(projectSwitchResultSchema, await api.createProject('C:/Projects/New', 'New'), 'mock create');
  });
});

describe('answers of the mock client for the settings, voice, model, transcript and tracks bindings', () => {
  it('the Settings fields of both scopes, and a saved setting', async () => {
    const api = createMockApi();
    expectMatches(settingsForScopeSchema, await api.settingsForScope('global'), 'mock global settings');
    expectMatches(settingsForScopeSchema, await api.settingsForScope('project'), 'mock project settings');
    expectMatches(bootstrapSchema, await api.saveSettings('General', 'global', { log_verbosity: 'verbose' }), 'mock saved settings');
  });

  it('the voice and model catalogs and their install jobs', async () => {
    const api = createMockApi();
    expectMatches(ttsCatalogSchema, await api.ttsCatalog(), 'mock voice catalog');
    const voice = (await api.ttsCatalog()).voices[0]?.id ?? '';
    const started = await api.ttsInstall(voice);
    for (const job of [
      started,
      await api.ttsInstallState(started.id),
      await api.ttsInstallState(started.id),
      await api.ttsInstallState(started.id),
      await api.ttsInstallCancel(started.id),
    ]) {
      expectMatches(ttsInstallJobSchema, job, 'mock voice install job');
    }
    expectMatches(whisperCatalogSchema, await api.whisperCatalog(), 'mock model catalog');
    const model = (await api.whisperCatalog()).models[0]?.id ?? '';
    const running = await api.whisperInstall(model);
    for (const job of [
      running,
      await api.whisperInstallState(running.id),
      await api.whisperInstallState(running.id),
      await api.whisperInstallState(running.id),
    ]) {
      expectMatches(whisperInstallJobSchema, job, 'mock model install job');
    }
  });

  it('the list of every approved asset, its install job and a verify', async () => {
    const api = createMockApi();
    const catalog = await api.assetsList();
    expectMatches(assetCatalogSchema, catalog, 'mock asset list');
    expect(catalog.assets.map((asset) => asset.kind)).toEqual(['tts', 'whisper', 'spacy']);
    const voice = catalog.assets[0];
    const started = await api.assetsInstall(voice.kind, voice.id);
    for (const job of [started, await api.assetsInstallState(started.id), await api.assetsInstallState(started.id), await api.assetsInstallState(started.id)]) {
      expectMatches(assetInstallJobSchema, job, 'mock asset install job');
    }
    expect((await api.assetsList()).assets[0].installState).toBe('installed');
    expectMatches(assetInstallJobSchema, await api.assetsInstallCancel(started.id), 'mock asset install cancel');
    expectMatches(assetVerifyResultSchema, await api.assetsVerify(voice.kind, voice.id), 'mock asset verify');
    await api.assetsRemove(voice.kind, voice.id);
    expect((await api.assetsList()).assets[0].installState).toBe('not_installed');
    await expect(api.assetsInstall('moonshine', 'x')).rejects.toThrow(/not in the approved catalog/);
  });

  it('the first-use gates for a model that is not installed, and a start that goes ahead', async () => {
    const api = createMockApi();
    const model = (await api.whisperCatalog()).models[0]?.id ?? '';
    expectMatches(startResultSchema, await api.transcriptStart({ model, chunk: '60', workers: '1', hints: '' }), 'mock transcript start');
    await api.whisperRemove(model);
    const gate = await api.transcriptStart({ model, chunk: '60', workers: '1', hints: '' });
    expect(gate.status).toBe('asset_required');
    expectMatches(startResultSchema, gate, 'mock transcript first-use gate');
    const chapter = (await api.manuscriptChapters())[0]?.id ?? '';
    expectMatches(startResultSchema, await api.teleprompterStart({ chapter, device: 'Microphone' }), 'mock teleprompter first-use gate');
  });

  it('the last completed run, the hints and the equivalence answer', async () => {
    const api = createMockApi();
    expectMatches(lastCompletedSchema, (await api.transcriptLastCompleted()) ?? null, 'mock last completed run');
    expectMatches(hintSuggestionsSchema, await api.transcriptSuggestHints(), 'mock hint suggestions');
    expectMatches(hintsSchema, await api.transcriptHints(), 'mock hints');
    expectMatches(equivalenceSchema, { message: await api.transcriptAddEquivalence('row-1') }, 'mock equivalence');
  });

  it.each(['available', 'found', 'failed', 'current', 'development', undefined] as const)('the update status the mock host answers (%s)', async (seed) => {
    const api = createMockApi({}, seed ? { update: seed } : {});
    expectMatches(updateStatusSchema, await api.updateStatus(), 'mock update status');
    expectMatches(updateStatusSchema, await api.updateCheck(), 'mock update check');
  });

  it.each(['downloading', 'available', 'download-fails'] as const)('the update download the mock host reports (%s)', async (seed) => {
    vi.useFakeTimers();
    const api = createMockApi({}, { update: seed });
    const started = await api.updateDownload();
    expectMatches(updateJobSchema, started, 'mock update download');
    for (let step = 0; step < 12; step++) {
      await vi.advanceTimersByTimeAsync(300);
      expectMatches(updateJobSchema, await api.updateJobState(started.id), 'mock update job');
    }
    expectMatches(updateJobSchema, await api.updateJobCancel(started.id), 'mock update job cancelled');
  });

  it('the update event the mock host sends when a background check found a release', async () => {
    vi.useFakeTimers();
    const seen: unknown[] = [];
    createMockApi({}, { update: 'found' }).subscribeUpdate((status) => seen.push(status));
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toHaveLength(1);
    expectMatches(updateStatusSchema, seen[0], 'mock update:status');
  });

  it('the Tracks answers', async () => {
    const api = createMockApi();
    expectMatches(tracksDiscoverySchema, await api.tracksDiscover(), 'mock tracks discovery');
    expectMatches(tracksProjectSchema, await api.tracksList(), 'mock tracks project');
    const several = createMockApi({}, { tracksCandidates: ['C:/A/A.rpp', 'C:/A/B.rpp'] });
    expectMatches(tracksDiscoverySchema, await several.tracksSelect('C:/A/B.rpp'), 'mock tracks selection');
    expectMatches(tracksDiscoverySchema, await createMockApi({}, { tracksCandidates: [] }).tracksDiscover(), 'mock tracks discovery, none found');
  });

  it('every method of the API is either checked in this file, void, or not a request', () => {
    // A new binding fails this until it has a schema and a row above (ADR 0069). The list of what is checked is kept by hand.
    const CHECKED = [
      'ready',
      'bootstrap',
      'saveSettings',
      'settingsForScope',
      'selectManuscript',
      'manuscriptBeginImport',
      'manuscriptImportState',
      'manuscriptImportPreview',
      'manuscriptImportCommit',
      'manuscriptChapters',
      'manuscriptParagraphs',
      'manuscriptSearch',
      'manuscriptSetChapterStatus',
      'noteList',
      'noteCreate',
      'manuscriptReader',
      'readerState',
      'readerStateSave',
      'readerBookmarkCreate',
      'guideBuild',
      'guideBuildState',
      'guideEntities',
      'guideCreate',
      'guidePreview',
      'assetsList',
      'assetsInstall',
      'assetsInstallState',
      'assetsInstallCancel',
      'assetsVerify',
      'ttsCatalog',
      'ttsInstall',
      'ttsInstallState',
      'ttsInstallCancel',
      'whisperCatalog',
      'whisperInstall',
      'whisperInstallState',
      'whisperInstallCancel',
      'transcriptStart',
      'transcriptLastCompleted',
      'transcriptAddEquivalence',
      'transcriptSuggestHints',
      'transcriptHints',
      'projectRecents',
      'selectProjectFolder',
      'switchProject',
      'createProject',
      'removeRecentProject',
      'tracksDiscover',
      'tracksSelect',
      'tracksList',
      'teleprompterStart',
      'teleprompterState',
      'updateStatus',
      'updateCheck',
      'updateDownload',
      'updateJobState',
      'updateJobCancel',
      'updateInstall',
    ];
    const VOID = [
      'manuscriptImportCancel',
      'clearProjectData',
      'readerBookmarkDelete',
      'noteDelete',
      'guideEdit',
      'guideSetLocked',
      'guideRescan',
      'guideMerge',
      'guideDelete',
      'guideRelate',
      'guideUnrelate',
      'ttsRemove',
      'whisperRemove',
      'assetsRemove',
      'transcriptCancel',
      'transcriptReset',
      'transcriptJump',
      'transcriptExportMarkers',
      'transcriptSaveHints',
      'teleprompterStop',
      'reportClientDiagnostic',
      'updateOpenNotes',
      'updateShowDownload',
    ];
    const NOT_A_REQUEST = [
      'mediaUrl',
      'subscribeProjectAttach',
      'subscribeLiveUpdateHealth',
      'subscribeNotices',
      'subscribeJobEnded',
      'subscribeTranscript',
      'subscribeTeleprompterEvent',
      'subscribeTeleprompterState',
      'subscribeUpdate',
    ];
    expect([...CHECKED, ...VOID, ...NOT_A_REQUEST].sort()).toEqual(Object.keys(createMockApi()).sort());
  });
});

describe('one deliberately broken sample per boundary fails with a specific message', () => {
  const failure = (schema: z.ZodType, value: unknown, payload: string): WireError => {
    try {
      parseWire(schema, value, ctx(payload));
    } catch (error) {
      if (error instanceof WireError) return error;
    }
    throw new Error(`${payload} was accepted`);
  };

  it('a binding result (Bootstrap with a numeric project name)', () => {
    const broken = { ...(readGolden('bootstrap-manuscript.json') as object), projectName: 42 };
    expect(failure(bootstrapSchema, broken, 'Bootstrap').details()).toMatch(
      /Bootstrap did not match its schema: projectName: Invalid input: expected string, received number/,
    );
  });

  it('a live event (a position with a text read index)', () => {
    const position = (readGolden('teleprompter-events.json') as Array<{ type: string }>).find((event) => event.type === 'position');
    expect(failure(teleprompterEventSchema, { ...position, read: 'four' }, 'teleprompter:event').issues.map((issue) => issue.path)).toEqual(['read']);
  });

  it('a state snapshot (a transcript phase the UI does not know)', () => {
    const broken = { ...(readGolden('transcript-idle.json') as object), phase: 'paused' };
    expect(failure(transcriptStateSchema, broken, 'transcript:state').issues[0]?.path).toBe('phase');
  });
});
