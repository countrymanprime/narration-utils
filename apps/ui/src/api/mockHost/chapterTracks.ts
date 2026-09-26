// The mock host (mockApi.ts): tracks, chapter links and chapter sync.
import type { ChapterSyncBatch, ChapterSyncChapter, ChapterSyncConsent, ChapterSyncState, ChapterSyncTrigger, NarrationApi, TrackMapping } from '../../types';
import { WIRE_TRACKS_PROJECT, wireClone } from '../mockFixtures';
import { mockChapterRegionPlan, mockChapterSyncPreview, mockChapterTrackLinks, mockChapterTrackMatch } from '../chapterTrackMatchMock';
import { mockChaptersForTracks, mockChapterSuggestion } from '../chapterSuggestionMock';
import type { CoverageResult } from '../contracts/coverage';
import { type MockApiSeed, mockDocumentId, type MockState } from './state';

/** The chapter-track bindings: the DAW project's tracks, the chapter links, chapter sync and chapter regions. */
export function createChapterTracksMock(
  s: MockState,
  initial: MockApiSeed,
  {
    manuscriptReady,
    dawFileLinked,
    peekCoverage,
  }: { manuscriptReady: Promise<void>; dawFileLinked: () => boolean; peekCoverage: (chapterId: string) => CoverageResult },
) {
  // Chapter sync (apps/desktop/chaptersync.go): the consent, the pairs the narrator undid, and who listens.
  let chapterSyncConsent: ChapterSyncConsent = initial.chapterSync === 'ask' ? 'undecided' : initial.chapterSync === 'off' ? 'off' : 'on';
  let chapterSyncDecidedAt: string | null = chapterSyncConsent === 'undecided' ? null : '2026-09-24T09:00:00Z';
  let chapterSyncLastSync: string | null = chapterSyncConsent === 'on' && initial.chapterSync !== 'linked' ? '2026-09-24T09:00:00Z' : null;
  const chapterSyncRejected = new Set<string>();
  const chapterSyncUnsavedEdits = initial.chapterSync === 'unsaved';
  // The Sync activity list, newest first (the host keeps 20): the unsaved seed shows one row from a save in REAPER.
  let chapterSyncActivity: ChapterSyncBatch[] =
    initial.chapterSync === 'unsaved'
      ? [{ at: '2026-09-24T09:05:00Z', trigger: 'watch', linked: [], newTracks: [{ guid: '{mock-room-tone}', name: 'Room tone', index: 9, marker: '' }] }]
      : [];
  const chapterSyncSubscribers = new Set<(state: ChapterSyncState) => void>();
  const mockLinksRead = () => {
    const state = s.tracksDiscovery.candidates.length === 0 ? 'none' : s.tracksDiscovery.selected ? 'ready' : 'choose';
    return mockChapterTrackLinks(s.chapters, WIRE_TRACKS_PROJECT, s.chapterTrackMappings, state);
  };
  const mockChapterSyncState = (batch: ChapterSyncBatch | null): ChapterSyncState => {
    const links = mockLinksRead();
    const plan = mockChapterSyncPreview(links, chapterSyncRejected);
    const manuscript = !initial.noManuscript && s.chapters.length > 0;
    return {
      consent: chapterSyncConsent,
      decidedAt: chapterSyncDecidedAt,
      ask: chapterSyncConsent === 'undecided' && manuscript && dawFileLinked(),
      manuscript,
      dawLinked: dawFileLinked(),
      project: links.project,
      message: links.message,
      projectFile: links.projectFile,
      savedAt: links.savedAt,
      lastSync: chapterSyncLastSync,
      counts: {
        linked: plan.kept.length + plan.autoLink.length,
        needsYou: plan.needsYou.length,
        noTrack: plan.noTrack.length,
        unmatched: plan.unmatched.length,
        pickupTracks: plan.pickupTracks.length,
      },
      batch,
      unsavedEdits: chapterSyncUnsavedEdits,
      activity: chapterSyncActivity,
      chapters: links.project === 'ready' ? mockChapterSyncRows(links) : [],
      background: { enabled: true, wait: 'nothing' },
    };
  };
  // Phase 6's status rows, as the host builds them: the link, and the recording check's own answer (the coverage mock's).
  const mockChapterSyncRows = (links: ReturnType<typeof mockLinksRead>): ChapterSyncChapter[] =>
    links.chapters.map((chapter, index) => {
      const link = chapter.links.length === 1 ? chapter.links[0] : undefined;
      const track = link ? links.tracks.find((summary) => summary.guid === link.trackGuid) : undefined;
      const result = peekCoverage(chapter.chapterId);
      const checkedAt = result.state === 'never' ? null : (result.record?.completedAt ?? null);
      const newestSourceAt = track ? '2026-09-21T10:00:00Z' : null;
      // The pickups seed gives the first chapter a pickup track (recognised by its name, never a link) changed since its scan.
      const pickups = initial.chapterSync === 'pickups' && index === 0;
      return {
        chapterId: chapter.chapterId,
        chapterTitle: chapter.chapterTitle,
        trackGuid: link?.trackGuid ?? '',
        trackName: track?.name ?? '',
        origin: link ? (link.origin ?? 'manual') : '',
        freshness: result.state,
        reasons: result.reasons,
        checkedAt,
        checking: false,
        trackChangedAt: null,
        newestSourceAt,
        lastChanged: newestSourceAt,
        pickupTrackGuid: pickups ? '{mock-pickups-track}' : '',
        pickupTrackName: pickups ? `${chapter.chapterTitle} (pickups)` : '',
        pickupsScannedAt: pickups ? '2026-09-21T09:00:00Z' : null,
        pickupsChanged: pickups,
      };
    });
  const publishChapterSync = (state: ChapterSyncState) => chapterSyncSubscribers.forEach((fn) => fn(wireClone(state)));
  // One sync, as the host's runChapterSync does it: the confident links written as auto, the batch when anything was linked.
  const runMockChapterSync = (trigger: ChapterSyncTrigger): ChapterSyncState => {
    const plan = mockChapterSyncPreview(mockLinksRead(), chapterSyncRejected);
    const at = new Date().toISOString();
    const linked: TrackMapping[] = plan.autoLink.map((link) => ({
      trackGuid: link.trackGuid,
      chapterId: link.chapterId,
      chapterTitle: link.chapterTitle,
      confirmedAt: at,
      origin: 'auto',
      match: link.match,
    }));
    s.chapterTrackMappings = [...s.chapterTrackMappings, ...linked];
    chapterSyncLastSync = at;
    const batch: ChapterSyncBatch | null = linked.length > 0 ? { at, trigger, linked, newTracks: [] } : null;
    if (batch) chapterSyncActivity = [batch, ...chapterSyncActivity].slice(0, 20);
    const state = mockChapterSyncState(batch);
    publishChapterSync(state);
    return state;
  };
  const bindings = {
    tracksDiscover: async () => wireClone(s.tracksDiscovery),
    tracksSelect: async (path) => {
      s.tracksDiscovery = { ...s.tracksDiscovery, selected: path };
      return wireClone(s.tracksDiscovery);
    },
    tracksList: async () => wireClone(WIRE_TRACKS_PROJECT),
    chapterTrackMapList: async () => ({ documentId: mockDocumentId, mappings: wireClone(s.chapterTrackMappings) }),
    chapterTrackMapConfirm: async (trackGuid, chapterId) => {
      await manuscriptReady;
      const chapter = s.chapters.find((candidate) => candidate.id === chapterId);
      if (!chapter) throw new Error('that chapter is not part of the current manuscript');
      const mapping: TrackMapping = { trackGuid, chapterId, chapterTitle: chapter.title, confirmedAt: new Date().toISOString(), origin: 'manual', match: null };
      s.chapterTrackMappings = [...s.chapterTrackMappings.filter((existing) => existing.trackGuid !== trackGuid), mapping];
      return wireClone(mapping);
    },
    chapterTrackMapClear: async (trackGuid) => {
      s.chapterTrackMappings = s.chapterTrackMappings.filter((existing) => existing.trackGuid !== trackGuid);
      return { documentId: mockDocumentId, mappings: wireClone(s.chapterTrackMappings) };
    },
    chapterTrackSet: async (chapterId, trackGuid) => {
      await manuscriptReady;
      const chapter = s.chapters.find((candidate) => candidate.id === chapterId);
      if (!chapter) throw new Error('that chapter is not part of the current manuscript');
      if (!trackGuid) throw new Error('choose a track before linking a chapter');
      const displaced = s.chapterTrackMappings.find((existing) => existing.trackGuid === trackGuid && existing.chapterId !== chapterId) ?? null;
      const link: TrackMapping = { trackGuid, chapterId, chapterTitle: chapter.title, confirmedAt: new Date().toISOString(), origin: 'manual', match: null };
      s.chapterTrackMappings = [...s.chapterTrackMappings.filter((existing) => existing.trackGuid !== trackGuid && existing.chapterId !== chapterId), link];
      return wireClone({ documentId: mockDocumentId, link, displaced, mappings: s.chapterTrackMappings });
    },
    chapterTrackUnlink: async (chapterId) => {
      await manuscriptReady;
      if (!s.chapters.some((candidate) => candidate.id === chapterId)) throw new Error('that chapter is not part of the current manuscript');
      s.chapterTrackMappings = s.chapterTrackMappings.filter((existing) => existing.chapterId !== chapterId);
      return { documentId: mockDocumentId, mappings: wireClone(s.chapterTrackMappings) };
    },
    chapterTrackLinks: async () => {
      await manuscriptReady;
      const state = s.tracksDiscovery.candidates.length === 0 ? 'none' : s.tracksDiscovery.selected ? 'ready' : 'choose';
      return wireClone(mockChapterTrackLinks(s.chapters, WIRE_TRACKS_PROJECT, s.chapterTrackMappings, state));
    },
    chapterSyncState: async () => {
      await manuscriptReady;
      return wireClone(mockChapterSyncState(null));
    },
    chapterSyncPreview: async () => {
      await manuscriptReady;
      return wireClone(mockChapterSyncPreview(mockLinksRead(), chapterSyncRejected));
    },
    chapterSyncSetEnabled: async (on) => {
      await manuscriptReady;
      chapterSyncConsent = on ? 'on' : 'off';
      chapterSyncDecidedAt = new Date().toISOString();
      if (on) return wireClone(runMockChapterSync('consent'));
      const state = mockChapterSyncState(null);
      publishChapterSync(state);
      return wireClone(state);
    },
    chapterSyncUndo: async (trackGuid) => {
      await manuscriptReady;
      const link = s.chapterTrackMappings.find((mapping) => mapping.trackGuid === trackGuid);
      if (!link) throw new Error('that track has no link to undo');
      if (link.origin !== 'auto') throw new Error('only an automatic link can be undone; unlink this track instead');
      s.chapterTrackMappings = s.chapterTrackMappings.filter((mapping) => mapping !== link);
      chapterSyncRejected.add(`${link.trackGuid}\u0000${link.chapterTitle}`);
      const state = mockChapterSyncState(null);
      publishChapterSync(state);
      return wireClone(state);
    },
    subscribeChapterSync: (onUpdate) => {
      chapterSyncSubscribers.add(onUpdate);
      if (initial.chapterSync === 'linked' && chapterSyncLastSync === null) {
        // App.tsx subscribes immediately on mount, well before bootstrap resolves and Home's AudiobookEstimatePanel
        // gets its own turn to subscribe; running this straight off manuscriptReady fires (and broadcasts) the
        // batch before that second subscriber exists, so its toast never shows. A short delay past the mock's own
        // settling lets every mount-time subscriber that will ever exist register first.
        void manuscriptReady.then(() => {
          setTimeout(() => {
            if (chapterSyncSubscribers.has(onUpdate) && chapterSyncLastSync === null) runMockChapterSync('daw-link');
          }, 250);
        });
      }
      return () => chapterSyncSubscribers.delete(onUpdate);
    },
    chapterRegionsPreview: async (openingTrackGuid, closingTrackGuid) => {
      await manuscriptReady;
      const state = s.tracksDiscovery.candidates.length === 0 ? 'none' : s.tracksDiscovery.selected ? 'ready' : 'choose';
      const links = mockChapterTrackLinks(s.chapters, WIRE_TRACKS_PROJECT, s.chapterTrackMappings, state);
      return wireClone(mockChapterRegionPlan(links, openingTrackGuid, closingTrackGuid));
    },
    chapterRegionsCreate: async (openingTrackGuid, closingTrackGuid, update) => {
      await manuscriptReady;
      const state = s.tracksDiscovery.candidates.length === 0 ? 'none' : s.tracksDiscovery.selected ? 'ready' : 'choose';
      const plan = mockChapterRegionPlan(
        mockChapterTrackLinks(s.chapters, WIRE_TRACKS_PROJECT, s.chapterTrackMappings, state),
        openingTrackGuid,
        closingTrackGuid,
      );
      if (plan.project !== 'ready') throw new Error(plan.message);
      if (plan.rows.length === 0) throw new Error('no chapter or credits entry has a linked track with recorded items, so there are no regions to create');
      const created = plan.rows.filter((row) => row.state === 'new' || (!update && row.state !== 'exists')).length;
      const updated = update ? plan.rows.filter((row) => row.state === 'moves').length : 0;
      const ambiguous = update ? plan.rows.filter((row) => row.state === 'ambiguous').length : 0;
      const existing = plan.rows.filter((row) => row.state === 'exists').length;
      return { sent: plan.rows.length, created, existing, invalid: 0, updated, ambiguous, failed: 0 };
    },
    chapterTrackMatch: async (chapterId) => {
      await manuscriptReady;
      return wireClone(mockChapterTrackMatch(chapterId, s.chapters, WIRE_TRACKS_PROJECT, s.chapterTrackMappings));
    },
    chapterSuggestion: async () => {
      await manuscriptReady;
      return wireClone(mockChapterSuggestion(s.chapters, WIRE_TRACKS_PROJECT, s.chapterTrackMappings, initial.armedTracks ?? []));
    },
    chaptersForTracks: async (guids) => {
      await manuscriptReady;
      return wireClone(mockChaptersForTracks(guids, s.chapters, WIRE_TRACKS_PROJECT, s.chapterTrackMappings));
    },
  } satisfies Partial<NarrationApi>;
  return { bindings, publishChapterSync, mockChapterSyncState };
}
