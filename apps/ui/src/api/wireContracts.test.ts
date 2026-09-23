import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DESKTOP_HOST_API_VERSION } from '../hostApi';
import { createMockApi } from './mockApi';
import { WIRE_TRACKS_PROJECT, WIRE_TRANSCRIPT } from './mockFixtures';
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
import { takeReviewCreateTakeResultSchema, takeReviewFindingsSchema } from './schemas/takeReview';
import { COVERAGE_EVALUATOR_REASONS, COVERAGE_REFUSAL_REASONS, coverageResultSchema, coverageStartResultSchema, coverageStateSchema } from './schemas/coverage';
import { tracksDiscoverySchema, tracksProjectSchema } from './schemas/tracks';
import { chapterSuggestionSchema, chapterTrackMappingSchema, chapterTrackMatchSchema, trackMappingSchema } from './schemas/chapterTrackMap';
import { ttsCatalogSchema, ttsInstallJobSchema } from './schemas/tts';
import { updateJobSchema, updateStatusSchema } from './schemas/update';
import { startResultSchema, whisperCatalogSchema, whisperInstallJobSchema } from './schemas/whisper';
import { dawLaunchResultSchema, dawLinkResultSchema, projectFolderSelectionSchema, projectSwitchResultSchema, recentProjectsSchema } from './schemas/project';
import {
  creditsAnnouncementsSchema,
  creditsProjectValuesResultSchema,
  creditsRenderResultSchema,
  creditTemplateSchema,
  creditTemplatesSchema,
  retailSampleAnswerSchema,
} from './schemas/credits';
import { dawCatalogListSchema } from './schemas/dawCatalog';
import { guideBuildResultSchema, guideCreatedSchema, guideEntitiesSchema, guidePreviewSchema } from './schemas/storyBible';
import { bootstrapSchema, jobEndedSchema, noticeSchema, projectAttachStateSchema, readySchema } from './schemas/system';
import {
  teleprompterDevicesResultSchema,
  teleprompterEventSchema,
  teleprompterFlagFindingsSchema,
  teleprompterLocatedSchema,
  teleprompterLocateResultSchema,
  teleprompterStartResultSchema,
  teleprompterStateSchema,
} from './schemas/teleprompter';
import { equivalenceSchema, hintSuggestionsSchema, hintsSchema, lastCompletedSchema, transcriptStateSchema } from './schemas/transcript';
import { lineIdentityStartResultSchema, lineIdentityStateSchema } from './schemas/lineidentity';
import { pickupsImportResultSchema, pickupsStartResultSchema, pickupsStateSchema } from './schemas/pickups';
import { renderConfigStartResultSchema, renderConfigStateSchema, renderConfigSuggestedFolderSchema } from './schemas/renderconfig';
import { chapterTagsEmbedResultSchema, chapterTagsPreviewSchema } from './schemas/chaptertags';
import { dictionaryLookupResultSchema } from './schemas/dictionary';
import { unknownKeys } from './schemas/strictness';
import { parseWire, type WireContext } from './wire/parseWire';
import { WireError } from './wire/WireError';
import { creditsRows } from '../components/teleprompter/readerModel';

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
  'teleprompter-credits-script.json': teleprompterEventSchema,
  'teleprompter-devices.json': teleprompterDevicesResultSchema,
  'teleprompter-start-asset-required-whisper.json': teleprompterStartResultSchema,
  'teleprompter-start-asset-required-moonshine.json': teleprompterStartResultSchema,
  // The sidecar's own `locate` line (locate.py), which the host checks and carries as `located`.
  'teleprompter-locate.json': teleprompterLocatedSchema.extend({ type: z.literal('locate') }),
  'teleprompter-locate-found.json': teleprompterLocateResultSchema,
  'teleprompter-locate-no-track.json': teleprompterLocateResultSchema,
  'teleprompter-locate-no-recording.json': teleprompterLocateResultSchema,
  'teleprompter-locate-source-missing.json': teleprompterLocateResultSchema,
  'teleprompter-save-flags.json': teleprompterFlagFindingsSchema,
  'manuscript-import-selected.json': workJobSchema,
  'manuscript-import-preview.json': workJobSchema,
  'manuscript-import-preview-repaired.json': workJobSchema,
  'manuscript-import-preview-text-subtitle.json': workJobSchema,
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
  'system-lookup-found.json': dictionaryLookupResultSchema,
  'system-lookup-asset-required.json': dictionaryLookupResultSchema,
  'project-recents.json': recentProjectsSchema,
  'project-recents-empty.json': recentProjectsSchema,
  'project-switch-attached.json': projectSwitchResultSchema,
  'project-switch-refused.json': projectSwitchResultSchema,
  'daw-link-selected.json': dawLinkResultSchema,
  'daw-link-folder-mismatch.json': dawLinkResultSchema,
  'daw-link-cancelled.json': dawLinkResultSchema,
  'daw-launch.json': dawLaunchResultSchema,
  'credits-templates.json': creditTemplatesSchema,
  'credits-project-values-empty.json': creditsProjectValuesResultSchema,
  'credits-preview-unresolved.json': creditsRenderResultSchema,
  'credits-chapter-announcements.json': creditsAnnouncementsSchema,
  'credits-retail-sample.json': retailSampleAnswerSchema,
  'credits-retail-sample-none.json': retailSampleAnswerSchema,
  'credits-retail-sample-stale.json': retailSampleAnswerSchema,
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
  'chapter-track-map-empty.json': chapterTrackMappingSchema,
  'chapter-track-map-confirmed.json': trackMappingSchema,
  'chapter-track-map-list.json': chapterTrackMappingSchema,
  'chapter-track-match-matched.json': chapterTrackMatchSchema,
  'chapter-track-match-ambiguous.json': chapterTrackMatchSchema,
  'chapter-track-match-none.json': chapterTrackMatchSchema,
  'chapter-suggestion-matched.json': chapterSuggestionSchema,
  'chapter-suggestion-ambiguous.json': chapterSuggestionSchema,
  'chapter-suggestion-none.json': chapterSuggestionSchema,
  'line-identity-idle.json': lineIdentityStateSchema,
  'line-identity-read-success.json': lineIdentityStateSchema,
  'pickups-idle.json': pickupsStateSchema,
  'pickups-import-success.json': pickupsStateSchema,
  'render-config-idle.json': renderConfigStateSchema,
  'render-config-success.json': renderConfigStateSchema,
  'chapter-tags-preview-idle.json': chapterTagsPreviewSchema,
  'chapter-tags-preview-ready.json': chapterTagsPreviewSchema,
  'chapter-tags-embed-success.json': chapterTagsEmbedResultSchema,
  'takereview-findings.json': takeReviewFindingsSchema,
  'takereview-create-take.json': takeReviewCreateTakeResultSchema,
  'manuscript-chapters-measured.json': chaptersSchema,
  'coverage-result-current.json': coverageResultSchema,
  'coverage-result-stale.json': coverageResultSchema,
  'coverage-result-never.json': coverageResultSchema,
  'coverage-result-unmapped.json': coverageResultSchema,
  'coverage-start-started.json': coverageStartResultSchema,
  'coverage-start-refused.json': coverageStartResultSchema,
  'coverage-state-idle.json': coverageStateSchema,
  'coverage-state-complete.json': coverageStateSchema,
  // Not a payload: the reason words the host can send, which the schema's lists must equal (the test below).
  'coverage-reasons.json': z.object({ refusal: z.array(z.string()), evaluator: z.array(z.string()) }),
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

  it('the coverage reason lists are the ones the host declares', () => {
    const declared = z.object({ refusal: z.array(z.string()), evaluator: z.array(z.string()) }).parse(readGolden('coverage-reasons.json'));
    expect([...COVERAGE_REFUSAL_REASONS]).toEqual(declared.refusal);
    expect([...COVERAGE_EVALUATOR_REASONS]).toEqual(declared.evaluator);
  });

  it('recordedFraction is only on the chapter the coverage measured', () => {
    const chapters = parseWire(chaptersSchema, readGolden('manuscript-chapters-measured.json'), ctx('chapters'));
    expect(chapters.map((chapter) => chapter.recordedFraction)).toEqual([0.75, ...chapters.slice(1).map(() => undefined)]);
    const unmeasured = parseWire(chaptersSchema, readGolden('manuscript-chapters.json'), ctx('chapters'));
    expect(unmeasured.every((chapter) => chapter.recordedFraction === undefined)).toBe(true);
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
    expect(new Set(events.map((event) => (event as { type: string }).type))).toEqual(new Set(['script', 'partial', 'position', 'flag']));
    for (const event of events) expectMatches(teleprompterEventSchema, event, 'mock teleprompter event');
    for (const state of states) expectMatches(teleprompterStateSchema, state, 'mock teleprompter state');
  });

  it.each(['listening', 'waiting', 'done'] as const)('a teleprompter session the host kept running (%s)', async (seed) => {
    const api = createMockApi({}, { teleprompter: seed });
    const state = await api.teleprompterState();
    expect(state.position?.status).toBe(seed);
    expectMatches(teleprompterStateSchema, state, `mock teleprompter ${seed}`);
  });

  it('a teleprompter session the host kept running with suspected flags raised (flagged)', async () => {
    const api = createMockApi({}, { teleprompter: 'flagged' });
    const events: unknown[] = [];
    api.subscribeTeleprompterEvent((event) => events.push(event));
    const state = await api.teleprompterState();
    expectMatches(teleprompterStateSchema, state, 'mock teleprompter flagged');
    expect(state.position?.status).toBe('listening');
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    for (const event of events) expectMatches(teleprompterEventSchema, event, 'mock teleprompter seeded flag');
    expect(new Set(events.map((event) => (event as { kind: string }).kind))).toEqual(new Set(['misread', 'skipped', 'restart', 'extra']));
  });

  it('the teleprompter device list', async () => {
    const api = createMockApi();
    expectMatches(teleprompterDevicesResultSchema, await api.teleprompterDevices(), 'mock teleprompter devices');
    const empty = createMockApi({}, { teleprompterDevices: [] });
    expectMatches(teleprompterDevicesResultSchema, await empty.teleprompterDevices(), 'mock teleprompter devices, none found');
  });

  it('teleprompterSeek moves a running session to the requested word, reported as a restart jump', async () => {
    const api = createMockApi();
    const events: unknown[] = [];
    api.subscribeTeleprompterEvent((event) => events.push(event));
    const chapter = (await api.manuscriptChapters())[0];
    await api.teleprompterStart({ chapter: chapter?.id ?? '', device: 'Microphone' });

    await api.teleprompterSeek(3);

    const seek = events.at(-1);
    expectMatches(teleprompterEventSchema, seek, 'mock teleprompter seek event');
    expect(seek).toMatchObject({ type: 'position', read: 3, committed: 3, jump: 'restart' });
  });

  it('the TeleprompterLocate answers, one per status the mock project reaches', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    const found = await api.teleprompterLocate(chapters[0].id);
    expectMatches(teleprompterLocateResultSchema, found, 'mock teleprompter locate, found');
    expect(found).toMatchObject({ status: 'found', tail: { to: 612.4 } });
    if (found.status === 'asset_required' || !found.located?.sentence) throw new Error('expected a located sentence');
    expect(found.located.sentence.start).toBeLessThanOrEqual(found.located.last ?? -1);
    expect(found.located.sentence.end).toBeGreaterThan(found.located.last ?? Infinity);

    const missing = await api.teleprompterLocate(chapters[1].id);
    expectMatches(teleprompterLocateResultSchema, missing, 'mock teleprompter locate, source missing');
    expect(missing.status).toBe('source_missing');

    const last = chapters[chapters.length - 1].id;
    const noTrack = await api.teleprompterLocate(last);
    expectMatches(teleprompterLocateResultSchema, noTrack, 'mock teleprompter locate, no track');
    expect(noTrack.status).toBe('no_track');

    const picked = await api.teleprompterLocate(last, { trackGuid: '{0E4D1D7F-D039-674D-87E6-719376DE95EC}' });
    expect(picked.status).toBe('found');
    await expect(api.teleprompterLocate(last, { trackGuid: '{00000000-0000-4000-8000-000000000000}' })).rejects.toThrow(/not in the selected/);
    await expect(api.teleprompterLocate('not-a-real-chapter')).rejects.toThrow();
  });

  // `?mockResume=` (main.tsx) reaches every resume card state on the first chapter (teleprompter-manuscript-integration.prd.md
  // Phase 10); each answer is still one the real host could send.
  it.each([
    ['low_confidence', 'low_confidence'],
    ['not_found', 'not_found'],
    ['ambiguous', 'no_track'],
    ['none', 'no_track'],
    ['no_recording', 'no_recording'],
    ['source_missing', 'source_missing'],
    ['source_unsupported', 'source_unsupported'],
  ] as const)('the ?mockResume=%s seed answers TeleprompterLocate with %s', async (resume, status) => {
    const api = createMockApi({}, { resume });
    const chapters = await api.manuscriptChapters();

    const result = await api.teleprompterLocate(chapters[0].id);

    expectMatches(teleprompterLocateResultSchema, result, `mock teleprompter locate, ${resume} seed`);
    expect(result.status).toBe(status);
  });

  it('the ambiguous seed offers the tied tracks, and reads the one the narrator picks', async () => {
    const api = createMockApi({}, { resume: 'ambiguous' });
    const chapters = await api.manuscriptChapters();

    const offered = await api.teleprompterLocate(chapters[0].id);
    if (offered.status === 'asset_required') throw new Error('expected a track match');
    expect(offered.match.status).toBe('ambiguous');
    expect(offered.match.candidates.length).toBeGreaterThan(1);

    const picked = await api.teleprompterLocate(chapters[0].id, { trackGuid: offered.match.candidates[0].trackGuid });
    expectMatches(teleprompterLocateResultSchema, picked, 'mock teleprompter locate, ambiguous seed after a pick');
    expect(picked.status).toBe('found');
  });

  it('the error seed rejects TeleprompterLocate, as a failed read of the .rpp or the sidecar does', async () => {
    const api = createMockApi({}, { resume: 'error' });
    const chapters = await api.manuscriptChapters();

    await expect(api.teleprompterLocate(chapters[0].id)).rejects.toThrow(/could not read/);
  });

  it('TeleprompterLocate asks for the model before transcribing a readable track', async () => {
    const api = createMockApi({}, { assets: 'missing' });
    const chapters = await api.manuscriptChapters();

    const required = await api.teleprompterLocate(chapters[0].id);

    expectMatches(teleprompterLocateResultSchema, required, 'mock teleprompter locate, asset required');
    expect(required.status).toBe('asset_required');
  });

  it('teleprompterSaveFlags answers one suspected finding per flag, and a dismissal is kept', async () => {
    const api = createMockApi();
    const chapter = (await api.manuscriptChapters())[0];
    const paragraph = (await api.manuscriptParagraphs(chapter?.id ?? ''))[0];
    const base = { paragraphId: paragraph?.id ?? '', scriptStart: 0, scriptEnd: 1, dismissed: false };
    const flags = [
      { ...base, kind: 'misread' as const, wordStart: 0, wordEnd: 1, heard: 'hello', dismissed: true },
      { ...base, kind: 'extra' as const, wordStart: 1, wordEnd: 2, heard: 'um' },
      { ...base, kind: 'skipped' as const, wordStart: 2, wordEnd: 3, heard: '' },
      { ...base, kind: 'restart' as const, wordStart: 0, wordEnd: 3, heard: 'the first words' },
    ];
    const saved = await api.teleprompterSaveFlags(chapter?.id ?? '', flags);
    expectMatches(teleprompterFlagFindingsSchema, saved, 'mock teleprompter saved flags');
    expect(saved.map((finding) => finding.review.status)).toEqual(['dismissed', 'unreviewed', 'unreviewed', 'unreviewed']);
    const again = await api.teleprompterSaveFlags(
      chapter?.id ?? '',
      flags.map((flag) => ({ ...flag, dismissed: false })),
    );
    expect(again[0].review.status).toBe('dismissed');
    await expect(
      api.teleprompterSaveFlags(chapter?.id ?? '', [{ ...base, kind: 'misread', paragraphId: 'nope', wordStart: 0, wordEnd: 1, heard: '' }]),
    ).rejects.toThrow(/nope/);
  });

  it('teleprompterSeek rejects when no session is running', async () => {
    const api = createMockApi();

    await expect(api.teleprompterSeek(3)).rejects.toThrow(/no teleprompter session/);
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

  it.each(['docx', 'markdown', 'repaired', 'text'] as const)(
    'the %s import preview the review dialog is built on, sections of every kind and character suggestions',
    async (kind) => {
      const api = createMockApi({}, { importPreview: kind });
      const jobId = (await api.selectManuscript()).jobId ?? '';
      const job = await api.manuscriptImportPreview(jobId, { markdownHeadingLevel: 1 });
      expectMatches(workJobSchema, job, `mock ${kind} import preview`);
      expect(job.preview?.format).toBe({ docx: 'docx', markdown: 'markdown', repaired: 'docx', text: 'txt' }[kind]);
      // Every subtitle says where its line goes when it is turned off, as the host's does (a plain-text line returns to the text).
      const subtitled = job.preview?.sections?.filter((section) => section.subtitle) ?? [];
      expect(subtitled.length).toBeGreaterThan(0);
      for (const section of subtitled) expect(section.subtitleOff).toBe(kind === 'text' ? 'body' : 'title');
      expect(job.preview?.notices !== undefined).toBe(kind === 'repaired');
      expect(new Set(job.preview?.sections?.map((section) => section.contentKind))).toEqual(new Set(['narration', 'opening', 'reference']));
      expect(job.preview?.characterCandidates).toHaveLength(3);
      expectMatches(
        workJobSchema,
        await api.manuscriptImportCommit(jobId, { confirmedReset: false, selection: { subtitleOverrides: { [subtitled[0]?.id ?? '']: false } } }),
        `mock ${kind} import commit`,
      );
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

  it('the dictionary lookup answers: a word it has, one it does not, and the first-use gate', async () => {
    const api = createMockApi();
    const found = await api.systemLookup('“Curious,”');
    expectMatches(dictionaryLookupResultSchema, found, 'mock lookup');
    expect(found.status === 'ok' && found.query === 'curious' && found.entries.length).toBe(1);
    expectMatches(dictionaryLookupResultSchema, await api.systemLookup('zorblax'), 'mock lookup of a word it does not have');
    expectMatches(
      dictionaryLookupResultSchema,
      await createMockApi({}, { dictionaryMissing: true }).systemLookup('curious'),
      'mock lookup, asking for the dictionary',
    );
    await expect(api.systemLookup('two words')).rejects.toThrow(/single word/);
  });

  it('the project picker answers', async () => {
    const api = createMockApi({}, { projectFolder: '' });
    expectMatches(recentProjectsSchema, await api.projectRecents(), 'mock recents');
    expectMatches(recentProjectsSchema, await api.removeRecentProject('C:/Projects/Voltage-and-the-Undercroft'), 'mock recents after remove');
    expectMatches(projectFolderSelectionSchema, await api.selectProjectFolder(), 'mock folder selection');
    expectMatches(projectSwitchResultSchema, await api.switchProject('C:/Projects/Other', 'Other'), 'mock switch');
    expectMatches(projectSwitchResultSchema, await api.createProject('C:/Projects/New', 'New'), 'mock create');
  });

  it('the DAW link binding answers, linked and refused on a folder mismatch', async () => {
    expectMatches(dawLinkResultSchema, await createMockApi().linkDawFile(), 'mock link');
    expectMatches(dawLinkResultSchema, await createMockApi({}, { dawLinkMismatch: true }).linkDawFile(), 'mock link, folder mismatch');
  });

  it('the DAW launch binding answers (Phase 8)', async () => {
    expectMatches(dawLaunchResultSchema, await createMockApi().launchDaw(), 'mock launch');
  });

  it('the credits template library, project values and preview answers (audiobook-credits-templates.prd.md, Phase 1)', async () => {
    const api = createMockApi();
    const templates = await api.creditsTemplates();
    expectMatches(creditTemplatesSchema, templates, 'mock credit templates');
    expect(templates.length).toBeGreaterThan(0);
    const created = await api.saveCreditsTemplate('', 'opening', 'My opening', '[Title], by [Author].');
    expectMatches(creditTemplateSchema, created, 'mock saved credit template');
    const updated = await api.saveCreditsTemplate(created.id, 'opening', 'My opening (edited)', '[Title].');
    expect(updated.id).toBe(created.id);
    const duplicated = await api.duplicateCreditsTemplate(templates[0].id);
    expectMatches(creditTemplateSchema, duplicated, 'mock duplicated credit template');
    expect(duplicated.id).not.toBe(templates[0].id);
    await api.deleteCreditsTemplate(created.id);
    expect((await api.creditsTemplates()).some((template) => template.id === created.id)).toBe(false);

    const values = await api.creditsProjectValues();
    expectMatches(creditsProjectValuesResultSchema, values, 'mock credits project values');
    const saved = await api.saveCreditsProjectValues({ title: 'Neon', author: 'A. Writer' });
    expectMatches(creditsProjectValuesResultSchema.shape.values, saved, 'mock saved credits project values');
    const preview = await api.creditsPreview('[Title], written by [Author], narrated by [Narrator].');
    expectMatches(creditsRenderResultSchema, preview, 'mock credits preview');
    expect(preview.text).toBe('Neon, written by A. Writer, narrated by [Narrator].');
    expect(preview.unresolved).toEqual(['Narrator']);
  });

  it('the chapter announcements and retail sample answers (audiobook-credits-templates.prd.md, Phase 5)', async () => {
    const api = createMockApi();
    const announcements = await api.creditsChapterAnnouncements('[Chapter]{: [Chapter Title]}.');
    expectMatches(creditsAnnouncementsSchema, announcements, 'mock chapter announcements');
    expect(announcements[0].result.text).toBe('Chapter 1: Down the Rabbit-Hole.');

    expectMatches(retailSampleAnswerSchema, await api.creditsRetailSample(), 'mock retail sample, none');
    const chapter = (await api.manuscriptChapters())[1];
    const [first, , third] = chapter.paragraphIds ?? [];
    const saved = await api.saveCreditsRetailSample(first.id, third.id);
    expectMatches(retailSampleAnswerSchema, saved, 'mock saved retail sample');
    expect(saved.sample).toMatchObject({ startChapterId: chapter.id, startLine: 1, endLine: 3 });
    expect(await api.creditsRetailSample()).toEqual(saved);
    await expect(api.saveCreditsRetailSample(first.id, 'p-9999')).rejects.toThrow(/pick the range again/);
    expectMatches(retailSampleAnswerSchema, await api.saveCreditsRetailSample('', ''), 'mock cleared retail sample');
  });

  it('the DAW catalog list and open-download-page answers, detected and not detected (Phase 2)', async () => {
    const detected = await createMockApi().dawCatalogList();
    expectMatches(dawCatalogListSchema, detected, 'mock catalog, detected');
    expect(detected[0]?.installed).toBe(true);
    const notDetected = await createMockApi({}, { dawCatalogInstalled: false }).dawCatalogList();
    expectMatches(dawCatalogListSchema, notDetected, 'mock catalog, not detected');
    expect(notDetected[0]?.installed).toBe(false);
    expect(notDetected[0]?.path).toBeUndefined();
    await expect(createMockApi().dawCatalogOpenDownloadPage('reaper')).resolves.toBeUndefined();
    await expect(createMockApi().dawCatalogOpenDownloadPage('not-a-real-daw')).rejects.toThrow(/Unknown DAW catalog entry/);
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
    expectMatches(teleprompterStartResultSchema, await api.teleprompterStart({ chapter, device: 'Microphone' }), 'mock teleprompter start');
  });

  it.each(['whisper', 'moonshine'] as const)('the teleprompter first-use gate names the engine whose model is missing (%s)', async (engine) => {
    const api = createMockApi({}, { assets: 'missing' });
    const chapter = (await api.manuscriptChapters())[0]?.id ?? '';
    const gate = await api.teleprompterStart({ chapter, device: 'Microphone', engine });
    expectMatches(teleprompterStartResultSchema, gate, `mock teleprompter first-use gate (${engine})`);
    expect(gate.status === 'asset_required' && gate.engine).toBe(engine);
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

  it('the ChapterTrackMap answers', async () => {
    const api = createMockApi();
    const empty = await api.chapterTrackMapList();
    expectMatches(chapterTrackMappingSchema, empty, 'mock chapter-track map, none confirmed');
    expect(empty.mappings).toHaveLength(0);

    const chapters = await api.manuscriptChapters();
    const confirmed = await api.chapterTrackMapConfirm('{0E4D1D7F-D039-674D-87E6-719376DE95EC}', chapters[0].id);
    expectMatches(trackMappingSchema, confirmed, 'mock chapter-track map confirmation');
    expect(confirmed.chapterTitle).toBe(chapters[0].title);

    const listed = await api.chapterTrackMapList();
    expectMatches(chapterTrackMappingSchema, listed, 'mock chapter-track map, one confirmed');
    expect(listed.mappings).toHaveLength(1);

    const cleared = await api.chapterTrackMapClear(confirmed.trackGuid);
    expectMatches(chapterTrackMappingSchema, cleared, 'mock chapter-track map after clear');
    expect(cleared.mappings).toHaveLength(0);

    await expect(api.chapterTrackMapConfirm('{0E4D1D7F-D039-674D-87E6-719376DE95EC}', 'not-a-real-chapter')).rejects.toThrow();
  });

  it('the ChapterTrackMatch answers', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    const matched = await api.chapterTrackMatch(chapters[0].id);
    expectMatches(chapterTrackMatchSchema, matched, 'mock chapter-track match, matched by name');
    expect(matched.status).toBe('matched');
    expect(matched.recordedEnd).not.toBeNull();

    const last = chapters[chapters.length - 1].id;
    const unmatched = await api.chapterTrackMatch(last);
    expectMatches(chapterTrackMatchSchema, unmatched, 'mock chapter-track match, no track');
    expect(unmatched.status).toBe('none');
    expect(unmatched.track).toBeNull();

    await api.chapterTrackMapConfirm('{DA2D209F-D10F-5E46-93E7-098D96499ED0}', last);
    const confirmed = await api.chapterTrackMatch(last);
    expectMatches(chapterTrackMatchSchema, confirmed, 'mock chapter-track match, confirmed');
    expect(confirmed.status).toBe('confirmed');

    await expect(api.chapterTrackMatch('not-a-real-chapter')).rejects.toThrow();
  });

  it('the ChapterSuggestion answers', async () => {
    const none = await createMockApi().chapterSuggestion();
    expectMatches(chapterSuggestionSchema, none, 'mock chapter suggestion, nothing armed');
    expect(none.basis).toBe('none');

    const [chapter1, chapter2] = WIRE_TRACKS_PROJECT.tracks;
    const matched = await createMockApi({}, { armedTracks: [chapter2.guid] }).chapterSuggestion();
    expectMatches(chapterSuggestionSchema, matched, 'mock chapter suggestion, armed track matched');
    expect(matched.status).toBe('matched');
    expect(matched.chapter?.chapterTitle).toBe('Chapter 2');

    const ambiguous = await createMockApi({}, { armedTracks: [chapter1.guid, chapter2.guid] }).chapterSuggestion();
    expectMatches(chapterSuggestionSchema, ambiguous, 'mock chapter suggestion, two armed tracks');
    expect(ambiguous.status).toBe('ambiguous');
    expect(ambiguous.chapter).toBeNull();

    const linkedApi = createMockApi({}, { armedTracks: [chapter2.guid] });
    const chapters = await linkedApi.manuscriptChapters();
    await linkedApi.chapterTrackMapConfirm(chapter2.guid, chapters[4].id);
    const confirmed = await linkedApi.chapterSuggestion();
    expectMatches(chapterSuggestionSchema, confirmed, 'mock chapter suggestion, confirmed link');
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.chapter?.chapterId).toBe(chapters[4].id);
  });

  it('the line-identity state through a stamp and a read run, and its seeded states', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const seen: unknown[] = [];
    api.subscribeLineIdentity((state) => seen.push(structuredClone(state)));
    expectMatches(
      lineIdentityStartResultSchema,
      await api.lineIdentityStamp([{ itemGuid: '{A}', lineId: 'c-0001', text: 'Chapter One' }], false),
      'mock stamp start',
    );
    await vi.advanceTimersByTimeAsync(300);
    expectMatches(lineIdentityStartResultSchema, await api.lineIdentityRead(), 'mock read start');
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.length).toBeGreaterThan(3);
    for (const state of seen) expectMatches(lineIdentityStateSchema, state, 'mock lineidentity:state');
    expectMatches(lineIdentityStateSchema, await api.lineIdentityState(), 'mock line-identity state');
    for (const seed of ['success', 'conflict', 'error'] as const) {
      expectMatches(lineIdentityStateSchema, await createMockApi({}, { lineIdentity: seed }).lineIdentityState(), `mock line-identity seed ${seed}`);
    }
  });

  it('lineIdentityStamp refuses an empty row list, the way the Go service does', async () => {
    await expect(createMockApi().lineIdentityStamp([], false)).rejects.toThrow(/select at least one item/);
  });

  it('the pickups state through import, export, next, resolve and count, and its seeded states', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const seen: unknown[] = [];
    api.subscribePickups((state) => seen.push(structuredClone(state)));
    const imported = await api.pickupsImport('start,note,tag\n1.5,Mispronounced,narrator\n9.25,Second pickup,\n');
    expectMatches(pickupsImportResultSchema, imported, 'mock import start');
    expect(imported.rowErrors).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expectMatches(pickupsStartResultSchema, await api.pickupsNext(), 'mock next start');
    await vi.advanceTimersByTimeAsync(300);
    expectMatches(pickupsStartResultSchema, await api.pickupsResolve(1.5), 'mock resolve start');
    await vi.advanceTimersByTimeAsync(300);
    expectMatches(pickupsStartResultSchema, await api.pickupsExport(), 'mock export start');
    await vi.advanceTimersByTimeAsync(300);
    expectMatches(pickupsStartResultSchema, await api.pickupsCount(), 'mock count start');
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.length).toBeGreaterThan(5);
    for (const state of seen) expectMatches(pickupsStateSchema, state, 'mock pickups:state');
    expectMatches(pickupsStateSchema, await api.pickupsState(), 'mock pickups state');
    for (const seed of ['import-success', 'next-success', 'export-success', 'error'] as const) {
      expectMatches(pickupsStateSchema, await createMockApi({}, { pickups: seed }).pickupsState(), `mock pickups seed ${seed}`);
    }
  });

  it('pickupsImport reports every unusable row and throws when none are usable', async () => {
    const api = createMockApi();
    await expect(api.pickupsImport('not-a-number,First\n')).rejects.toThrow(/no valid pickups/);
    const result = await api.pickupsImport('1.5,Good row\nnot-a-number,Bad row\n');
    expect(result.rowErrors).toEqual(['line 2: could not parse this row']);
  });

  it('the render-config state through a configure run, and its seeded states', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const seen: unknown[] = [];
    api.subscribeRenderConfig((state) => seen.push(structuredClone(state)));
    expectMatches(renderConfigSuggestedFolderSchema, await api.renderConfigSuggestFolder(), 'mock suggested folder');
    expectMatches(renderConfigStartResultSchema, await api.renderConfigConfigure('C:/Books/Alice/renders'), 'mock configure start');
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.length).toBeGreaterThan(1);
    for (const state of seen) expectMatches(renderConfigStateSchema, state, 'mock renderconfig:state');
    expectMatches(renderConfigStateSchema, await api.renderConfigState(), 'mock render-config state');
    for (const seed of ['success', 'no-regions', 'error'] as const) {
      expectMatches(renderConfigStateSchema, await createMockApi({}, { renderConfig: seed }).renderConfigState(), `mock render-config seed ${seed}`);
    }
  });

  it('renderConfigConfigure refuses an empty folder, the way the Go service does', async () => {
    await expect(createMockApi().renderConfigConfigure('   ')).rejects.toThrow(/output folder is required/);
  });

  it('chapterTagsPreview and its seeded states', async () => {
    expectMatches(chapterTagsPreviewSchema, await createMockApi().chapterTagsPreview(), 'mock chapter-tags preview idle');
    for (const seed of ['ready', 'not-rendered'] as const) {
      expectMatches(chapterTagsPreviewSchema, await createMockApi({}, { chapterTags: seed }).chapterTagsPreview(), `mock chapter-tags preview seed ${seed}`);
    }
  });

  it('chapterTagsEmbed writes a tagged copy, refuses a blank destination, and can be seeded to error', async () => {
    const api = createMockApi({}, { chapterTags: 'ready' });
    expectMatches(chapterTagsEmbedResultSchema, await api.chapterTagsEmbed('C:/Books/Alice/renders/Alice.mp3'), 'mock chapter-tags embed success');
    await expect(api.chapterTagsEmbed('   ')).rejects.toThrow(/choose the MP3 file/);
    await expect(
      createMockApi({}, { chapterTags: 'ready', chapterTagsEmbedAlwaysErrors: true }).chapterTagsEmbed('C:/Books/Alice/renders/Alice.mp3'),
    ).rejects.toThrow();
  });

  it('the take-review scan and findings answers', async () => {
    const api = createMockApi();
    const scanned = await api.takeReviewScan('Chapter 1');
    expectMatches(takeReviewFindingsSchema, scanned, 'mock take-review scan');
    expect(scanned.length).toBeGreaterThan(0);
    const readBack = await api.takeReviewFindings('Chapter 1');
    expectMatches(takeReviewFindingsSchema, readBack, 'mock take-review findings');
    expect(readBack).toEqual(scanned);
    const empty = await api.takeReviewScan('Chapter 2');
    expectMatches(takeReviewFindingsSchema, empty, 'mock take-review scan, no repeats');
    expect(empty).toEqual([]);
  });

  it('the take-creation answer', async () => {
    const api = createMockApi();
    const result = await api.takeReviewCreateTake({
      findingId: 'finding-1',
      targetItemGuid: '{AAAAAAAA-0000-4000-8000-000000000001}',
      candidateItemGuid: '',
      sourceFile: 'C:/Projects/Alice/media/chapter1-take2.wav',
      sourceRangeStart: 0,
      sourceRangeEnd: 3,
    });
    expectMatches(takeReviewCreateTakeResultSchema, result, 'mock take creation');
    expect(result.targetItemGuid).toBe('{AAAAAAAA-0000-4000-8000-000000000001}');
  });

  it('the recording coverage answers: a current, a never and a stale result, a check to its end, and every refusal', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    const measured = chapters.find((chapter) => chapter.recordedFraction !== undefined);
    if (!measured) throw new Error('the mock chapters carry a measured recordedFraction');
    const current = await api.coverageResult(measured.id);
    expectMatches(coverageResultSchema, current, 'mock coverage result, current');
    expect(current.state).toBe('current');
    expect(current.recordedFraction).toBe(measured.recordedFraction);
    const unknown = await api.coverageResult('no-such-chapter');
    expectMatches(coverageResultSchema, unknown, 'mock coverage result, never');
    expect(unknown).toMatchObject({ state: 'never', reasons: ['chapter_not_found'] });
    expectMatches(coverageStateSchema, await api.coverageState(), 'mock coverage state, idle');

    const staleApi = createMockApi({}, { coverage: { stale: [measured.id] } });
    const stale = await staleApi.coverageResult(measured.id);
    expectMatches(coverageResultSchema, stale, 'mock coverage result, stale');
    expect(stale.state).toBe('stale');
    expect(stale.recordedFraction).toBeUndefined();
    const staleChapter = (await staleApi.manuscriptChapters()).find((chapter) => chapter.id === measured.id);
    expect(staleChapter?.recordedFraction).toBeUndefined();

    vi.useFakeTimers();
    try {
      const states: unknown[] = [];
      const ended: string[] = [];
      api.subscribeCoverage((state) => states.push(state));
      api.subscribeJobEnded((event) => ended.push(`${event.kind}:${event.outcome}`));
      const started = await api.coverageStart(measured.id);
      expectMatches(coverageStartResultSchema, started, 'mock coverage start');
      expect(started.status).toBe('started');
      const busy = await api.coverageStart(measured.id);
      expectMatches(coverageStartResultSchema, busy, 'mock coverage start, busy');
      expect(busy).toMatchObject({ status: 'refused', reason: 'busy' });
      await vi.runAllTimersAsync();
      states.forEach((state, index) => expectMatches(coverageStateSchema, state, `mock coverage:state ${index}`));
      expect(await api.coverageState()).toMatchObject({ phase: 'complete', percent: 100 });
      expect(ended).toEqual(['recording_coverage:success']);
    } finally {
      vi.useRealTimers();
    }

    for (const reason of COVERAGE_REFUSAL_REASONS) {
      const refused = await createMockApi({}, { coverage: { refusal: reason } }).coverageStart(measured.id);
      expectMatches(coverageStartResultSchema, refused, `mock coverage start, refused ${reason}`);
      expect(refused).toMatchObject({ status: 'refused', reason });
    }
    const gated = await createMockApi({}, { assets: 'missing' }).coverageStart(measured.id);
    expectMatches(coverageStartResultSchema, gated, 'mock coverage start, model not installed');
    expect(gated.status).toBe('asset_required');
  });

  it('every method of the API is either checked in this file, void, or not a request', () => {
    // A new binding fails this until it has a schema and a row above (ADR 0069). The list of what is checked is kept by hand.
    const CHECKED = [
      'ready',
      'bootstrap',
      'systemLookup',
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
      'linkDawFile',
      'launchDaw',
      'dawCatalogList',
      'tracksDiscover',
      'tracksSelect',
      'tracksList',
      'chapterTrackMapList',
      'chapterTrackMapConfirm',
      'chapterTrackMapClear',
      'chapterTrackMatch',
      'chapterSuggestion',
      'lineIdentityStamp',
      'lineIdentityRead',
      'lineIdentityState',
      'pickupsImport',
      'pickupsExport',
      'pickupsNext',
      'pickupsResolve',
      'pickupsCount',
      'pickupsState',
      'renderConfigConfigure',
      'renderConfigSuggestFolder',
      'renderConfigState',
      'chapterTagsPreview',
      'chapterTagsEmbed',
      'takeReviewScan',
      'takeReviewFindings',
      'takeReviewCreateTake',
      'coverageStart',
      'coverageState',
      'coverageResult',
      'teleprompterStart',
      'teleprompterState',
      'teleprompterDevices',
      'teleprompterLocate',
      'teleprompterSaveFlags',
      'updateStatus',
      'updateCheck',
      'updateDownload',
      'updateJobState',
      'updateJobCancel',
      'updateInstall',
      'creditsTemplates',
      'saveCreditsTemplate',
      'duplicateCreditsTemplate',
      'creditsProjectValues',
      'saveCreditsProjectValues',
      'creditsPreview',
      'creditsChapterAnnouncements',
      'creditsRetailSample',
      'saveCreditsRetailSample',
    ];
    const VOID = [
      'manuscriptImportCancel',
      'clearProjectData',
      'readerBookmarkDelete',
      'noteDelete',
      'guideEdit',
      'guideSetLocked',
      'guideRescan',
      'guidePronounce',
      'guideMerge',
      'guideDelete',
      'guideRelate',
      'guideUnrelate',
      'ttsRemove',
      'whisperRemove',
      'assetsRemove',
      'transcriptCancel',
      'coverageCancel',
      'transcriptReset',
      'transcriptJump',
      'transcriptExportMarkers',
      'transcriptSaveHints',
      'teleprompterStop',
      'dawCatalogOpenDownloadPage',
      'teleprompterSeek',
      'reportClientDiagnostic',
      'systemNotify',
      'updateOpenNotes',
      'updateShowDownload',
      'deleteCreditsTemplate',
    ];
    const NOT_A_REQUEST = [
      'mediaUrl',
      'subscribeProjectAttach',
      'subscribeLiveUpdateHealth',
      'subscribeNotices',
      'subscribeJobEnded',
      'subscribeTranscript',
      'subscribeCoverage',
      'subscribeTeleprompterEvent',
      'subscribeTeleprompterState',
      'subscribeUpdate',
      'subscribeLineIdentity',
      'subscribePickups',
      'subscribeRenderConfig',
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

  it('a live event (a flag of a kind the UI does not know)', () => {
    const flags = (readGolden('teleprompter-events.json') as Array<{ type: string; kind?: string }>).filter((event) => event.type === 'flag');
    expect(new Set(flags.map((flag) => flag.kind))).toEqual(new Set(['misread', 'extra', 'skipped', 'restart']));
    expect(failure(teleprompterEventSchema, { ...flags[0], kind: 'mumbled' }, 'teleprompter:event').issues.map((issue) => issue.path)).toEqual(['kind']);
  });

  it('a state snapshot (a transcript phase the UI does not know)', () => {
    const broken = { ...(readGolden('transcript-idle.json') as object), phase: 'paused' };
    expect(failure(transcriptStateSchema, broken, 'transcript:state').issues[0]?.path).toBe('phase');
  });
});

// The sidecar's credits script (chapter_script.text_script, ADR 0150) and the reader's `creditsRows` split the same text the
// same way: every span of the golden lands on a line of the text the Python test built it from, with every word tracked.
describe('the credits script the sidecar sends', () => {
  it('lays over the reader rows of the same text with no drift', () => {
    const text = 'You have been listening to Alice, written by Lewis Carroll,\nnarrated by Ada Finch.\n\nThe End.';
    const script = parseWire(teleprompterEventSchema, readGolden('teleprompter-credits-script.json'), ctx('teleprompter:event'));
    if (script.type !== 'script') throw new Error('the golden is not a script event');

    const rows = creditsRows('closing', text, script);

    expect(rows.map((row) => [row.key, row.start, row.words?.length])).toEqual(script.spans.map((span) => [span.id, span.start, span.count]));
  });
});
