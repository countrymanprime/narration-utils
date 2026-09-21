import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
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
import { projectFolderSelectionSchema, projectSwitchResultSchema, recentProjectsSchema } from './schemas/project';
import { guideCreatedSchema, guideEntitiesSchema, guidePreviewSchema } from './schemas/storyBible';
import { bootstrapSchema, projectAttachStateSchema, readySchema } from './schemas/system';
import { teleprompterEventSchema, teleprompterStateSchema } from './schemas/teleprompter';
import { transcriptStateSchema } from './schemas/transcript';
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
  'guide-preview-asset-required.json': guidePreviewSchema,
  'project-recents.json': recentProjectsSchema,
  'project-recents-empty.json': recentProjectsSchema,
  'project-switch-attached.json': projectSwitchResultSchema,
  'project-switch-refused.json': projectSwitchResultSchema,
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
    expect(parseWire(bootstrapSchema, readGolden('bootstrap-manuscript.json'), ctx('bootstrap')).apiVersion).toBe(5);
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

  it('the Story Bible entities, build job, created id and preview answers', async () => {
    const api = createMockApi();
    expectMatches(guideEntitiesSchema, await api.guideEntities(), 'mock entities');
    expectMatches(workJobSchema, await api.guideBuildState(), 'mock guide state');
    expectMatches(workJobSchema, await api.guideBuild(), 'mock guide build');
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
