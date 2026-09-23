// The browser mock's findings store, answering the review bindings the way apps/desktop/internal/findings does:
// the same filters, sort keys (a missing value sorts last either way), ties by chapter then id, paging with the
// total before paging, counts over the latest run, and a decision refused when the evidence changed (ADR 0120).
// It exists so the Review page can be built and screenshotted without a host; the host's rules are the ones that
// count, and apps/desktop/internal/findings/query_test.go pins them.
import type {
  Finding,
  FindingMarker,
  FindingMarkerRefusal,
  FindingNavigation,
  FindingNavigationRefusal,
  FindingReviewStatus,
  FindingsApi,
  FindingsQuery,
  FindingsSummary,
  FindingSeverity,
  FindingSortKey,
  ReaperStatus,
} from '../types';
import { FINDING_CATEGORIES, MAX_REVIEW_NOTE_LENGTH } from './contracts/findings';
import { wireClone } from './mockFixtures';
import { takeReviewEvidenceSchema } from './schemas/takeReview';

const SEVERITY_ORDER: FindingSeverity[] = ['error', 'warning', 'info'];

const STATUSES: readonly FindingReviewStatus[] = ['unreviewed', 'accepted', 'dismissed', 'deferred'];
const SORT_KEYS: readonly FindingSortKey[] = ['chapter', 'time', 'confidence', 'severity'];

/** Query.Validate: the first field the host cannot answer, so a bad filter fails here as loudly as it does there. */
function validateQuery(query: FindingsQuery): void {
  const refuse = (message: string) => {
    throw new Error(message);
  };
  if (query.category && !FINDING_CATEGORIES.some((category) => category === query.category))
    refuse(`category "${query.category}" is not a documented category`);
  if (query.severity && !SEVERITY_ORDER.includes(query.severity)) refuse(`severity "${query.severity}" is not info, warning, or error`);
  if (query.status && !STATUSES.includes(query.status)) refuse(`review status "${query.status}" is not recognised`);
  if (query.sort && !SORT_KEYS.includes(query.sort)) refuse(`sort "${query.sort}" is not chapter, time, confidence, or severity`);
  if (query.minConfidence !== undefined && !(query.minConfidence >= 0 && query.minConfidence <= 1)) {
    refuse(`minimum confidence ${query.minConfidence} is outside 0 to 1`);
  }
  if ((query.limit ?? 0) < 0) refuse(`limit ${query.limit} is negative`);
  if ((query.offset ?? 0) < 0) refuse(`offset ${query.offset} is negative`);
}

const chapterOf = (finding: Finding): string => finding.manuscript?.chapter_id ?? '';

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Present values in order (reversed when descending) before missing ones, whatever the direction. */
function compareOptional(a: number | null | undefined, b: number | null | undefined, descending: boolean): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return descending ? b - a : a - b;
}

function comparePrimary(a: Finding, b: Finding, query: FindingsQuery): number {
  const descending = query.descending === true;
  const reverse = (value: number) => (descending ? -value : value);
  switch (query.sort) {
    case 'time':
      return compareOptional(a.time_range?.start, b.time_range?.start, descending);
    case 'confidence':
      return compareOptional(a.confidence, b.confidence, descending);
    case 'severity':
      return reverse(SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
    default:
      return reverse(compareText(chapterOf(a), chapterOf(b)));
  }
}

function matches(finding: Finding, query: FindingsQuery): boolean {
  if (query.analyzer && finding.analyzer !== query.analyzer) return false;
  if (query.category && finding.category !== query.category) return false;
  if (query.severity && finding.severity !== query.severity) return false;
  if (query.status && finding.review.status !== query.status) return false;
  if (query.chapterId && chapterOf(finding) !== query.chapterId) return false;
  if (query.minConfidence !== undefined && (finding.confidence === null || finding.confidence < query.minConfidence)) return false;
  return query.includeNotInLatestRun === true || finding.not_in_latest_run !== true;
}

function summarize(all: Finding[]): FindingsSummary {
  const latest = all.filter((finding) => finding.not_in_latest_run !== true);
  const count = (status: Finding['review']['status']) => latest.filter((finding) => finding.review.status === status).length;
  const titles = new Map<string, string | undefined>();
  for (const finding of all) {
    const id = chapterOf(finding);
    if (id && (finding.manuscript?.chapter_title || !titles.has(id))) titles.set(id, finding.manuscript?.chapter_title);
  }
  return {
    total: latest.length,
    unreviewed: count('unreviewed'),
    accepted: count('accepted'),
    dismissed: count('dismissed'),
    deferred: count('deferred'),
    notInLatestRun: all.length - latest.length,
    analyzers: [...new Set(all.map((finding) => finding.analyzer))].sort(compareText),
    categories: [...new Set(all.map((finding) => finding.category))].sort(compareText),
    chapters: [...titles.entries()].sort(([a], [b]) => compareText(a, b)).map(([id, title]) => (title ? { id, title } : { id })),
  };
}

/** The analyzer "runs again" once: every finding gets a new evidence version, as a re-run with changed evidence does. */
const rerun = (findings: Finding[]): Finding[] =>
  findings.map((finding) => ({ ...finding, evidence_version: `${finding.evidence_version ?? ''}-rerun`, review: { ...finding.review, status: 'unreviewed' } }));

/**
 * What the mock's REAPER is doing (review dashboard Phase 7): connected, not there at all, or connected and refusing every Go to and
 * Loop for one reason, so each state the Review page words differently can be seen without REAPER.
 */
export type MockReaper = 'connected' | 'standalone' | 'not-running' | 'stale' | 'recording' | 'outdated';

// The host's words (apps/desktop/bindings_navigation.go); findingsMock.test.ts checks them against its golden payloads.
export const REAPER_MESSAGES = {
  standalone: 'REAPER is not connected to this app. To go to findings in REAPER, open this app from the Narration Utils action in REAPER.',
  notRunning: 'REAPER is not answering. Check that REAPER is open and the Narration Utils action is running, then try again.',
  noItem: 'This finding has no REAPER item to go to, because it came from an older check. Run the check again to record one.',
  noSourceTime: 'This finding has no time in its audio to loop. Go to it instead.',
  stale: "This finding's item is no longer in the REAPER project, so nothing was moved. Run the check again to find it where it is now.",
  recording: 'REAPER is recording, so nothing was moved. Stop recording first.',
  outdated: "The Narration Utils script in REAPER is older than this app. Import it again from this app's REAPER folder, then try again.",
  // The approved marker's own words (apps/desktop/bindings_marker.go, review dashboard Phase 8).
  notAccepted: 'Accept this finding first. Only a finding you accepted gets a marker in REAPER.',
  markerNoItem: 'This finding has no REAPER item to mark, because it came from an older check. Run the check again to record one.',
  markerNoSourceTime: 'This finding has no time in its audio to put a marker at.',
  markerStale: "This finding's item is no longer in the REAPER project, so no marker was added. Run the check again to find it where it is now.",
  markerRecording: 'REAPER is recording, so no marker was added. Stop recording first.',
} as const;

/**
 * The approved marker's name as the host builds it (approvedMarker in apps/desktop/bindings_marker.go): the finding's kind (or its
 * category), then what the script says and what was heard, eight words at most each, like Transcript Compare's own markers.
 */
export function approvedMarkerName(finding: Finding): string {
  const evidenceKind = finding.evidence?.kind;
  const kind = typeof evidenceKind === 'string' && /^[A-Za-z_]+$/.test(evidenceKind) ? evidenceKind : finding.category;
  const snippet = (text: string | undefined): string => {
    const words = (text ?? '').split(/\s+/).filter(Boolean);
    return words.length > 8 ? `${words.slice(0, 8).join(' ')} ...` : words.join(' ');
  };
  const expected = snippet(finding.manuscript?.expected);
  const recorded = snippet(finding.manuscript?.recorded);
  const body = expected && recorded ? `'${expected}' as '${recorded}'` : expected ? `'${expected}'` : recorded ? `'${recorded}'` : 'approved finding';
  return `${kind.toUpperCase()}: ${body}`;
}

/** ContextPaddingSeconds (apps/desktop/internal/bridge/navigation.go): the audio a loop plays either side of a finding. */
const LOOP_PADDING_SECONDS = 2;

type FindingsMockOptions = {
  /** After the first list the page gets, the analyzer runs again, so a decision on what that list showed is refused as stale. */
  rerunAfterFirstList?: boolean;
  /** What the mock's REAPER does; `connected` when not given. */
  reaper?: MockReaper;
};

const refused = (reason: FindingNavigationRefusal, message: string): FindingNavigation => ({ outcome: 'refused', reason, message });
const markerRefused = (reason: FindingMarkerRefusal, message: string): FindingMarker => ({ outcome: 'refused', reason, message });

/** The REAPER side of the review bindings, refusing in the host's order: the finding first, then the connection, then REAPER. */
function createReaperMock(mode: MockReaper, find: (id: string) => Finding) {
  let loopingId: string | undefined;
  // A read stands in for its finding: its own item, and its range in its own source (bindings_navigation.go's readTarget).
  const readOf = (id: string, read: number) => {
    const members = takeReviewEvidenceSchema.safeParse(find(id).evidence);
    const member = members.success ? members.data.members[read] : undefined;
    if (!member) throw new Error(`this finding has no read ${read + 1}; reload the list`);
    const start = member.source_start;
    const finding: Finding = { ...find(id), source: { file: member.source_file, item_guid: member.item_guid || undefined } };
    return { finding, start, end: start + member.source_length };
  };
  const marked = new Set<string>();
  const status = (): ReaperStatus => {
    if (mode === 'standalone') return { connection: 'standalone', message: REAPER_MESSAGES.standalone };
    if (mode === 'not-running') return { connection: 'not_running', message: REAPER_MESSAGES.notRunning };
    return loopingId ? { connection: 'connected', loopingFindingId: loopingId } : { connection: 'connected' };
  };
  const refusalOf = (finding: Finding, needsTime: boolean): FindingNavigation | undefined => {
    if (!finding.source.item_guid) return refused('no_item', REAPER_MESSAGES.noItem);
    if (needsTime && finding.time_range?.source_start === undefined) return refused('no_source_time', REAPER_MESSAGES.noSourceTime);
    const now = status();
    if (now.connection !== 'connected') return refused(now.connection, now.message ?? '');
    if (mode === 'stale') return refused('stale', REAPER_MESSAGES.stale);
    if (mode === 'recording') return refused('recording', REAPER_MESSAGES.recording);
    if (mode === 'outdated') return refused('script_outdated', REAPER_MESSAGES.outdated);
    return undefined;
  };
  return {
    findingsReaperStatus: async () => status(),
    findingsGoTo: async (id: string): Promise<FindingNavigation> => {
      const finding = find(id);
      return refusalOf(finding, false) ?? { outcome: 'navigated', projectTime: finding.time_range?.start ?? 0 };
    },
    findingsLoop: async (id: string): Promise<FindingNavigation> => {
      const finding = find(id);
      const refusal = refusalOf(finding, true);
      if (refusal) return refusal;
      loopingId = id;
      const range = finding.time_range ?? { start: 0, end: 0 };
      return { outcome: 'looping', loopStart: Math.max(range.start - LOOP_PADDING_SECONDS, 0), loopEnd: range.end + LOOP_PADDING_SECONDS };
    },
    // One read of a take-review group (take review Phase 5): placed by the read's own item and range, refused like the finding.
    findingsGoToRead: async (id: string, read: number): Promise<FindingNavigation> => {
      const { finding, start } = readOf(id, read);
      return refusalOf(finding, false) ?? { outcome: 'navigated', projectTime: start };
    },
    findingsLoopRead: async (id: string, read: number): Promise<FindingNavigation> => {
      const { finding, start, end } = readOf(id, read);
      const refusal = refusalOf(finding, false);
      if (refusal) return refusal;
      loopingId = id;
      return { outcome: 'looping', loopStart: Math.max(start - LOOP_PADDING_SECONDS, 0), loopEnd: end + LOOP_PADDING_SECONDS };
    },
    findingsAddMarker: async (id: string): Promise<FindingMarker> => {
      const finding = find(id);
      if (finding.review.status !== 'accepted') return markerRefused('not_accepted', REAPER_MESSAGES.notAccepted);
      if (!finding.source.item_guid) return markerRefused('no_item', REAPER_MESSAGES.markerNoItem);
      const sourceTime = finding.time_range?.source_start;
      if (sourceTime === undefined) return markerRefused('no_source_time', REAPER_MESSAGES.markerNoSourceTime);
      const now = status();
      if (now.connection !== 'connected') return markerRefused(now.connection, now.message ?? '');
      if (mode === 'stale') return markerRefused('stale', REAPER_MESSAGES.markerStale);
      if (mode === 'recording') return markerRefused('recording', REAPER_MESSAGES.markerRecording);
      if (mode === 'outdated') return markerRefused('script_outdated', REAPER_MESSAGES.outdated);
      const outcome = marked.has(id) ? 'existing' : 'added';
      marked.add(id);
      return { outcome, name: approvedMarkerName(finding), sourceTime };
    },
    findingsStopLoop: async (): Promise<FindingNavigation> => {
      const now = status();
      if (now.connection !== 'connected') return refused(now.connection, now.message ?? '');
      const restored = loopingId ? 3 : 0;
      loopingId = undefined;
      return { outcome: 'stopped', restored, kept: 0 };
    },
  };
}

/**
 * The mock store and one more door the host has and the page does not: what an analyzer run saves (the take-review scan
 * mock writes through it), replacing that analyzer's findings for one chapter the way findings.Store.SaveAnalyzerFindings does
 * for a fresh run (decisions on a finding found again are kept; one not found again is dropped here, not carried forward).
 */
export function createFindingsMock(
  seed: Finding[],
  options: FindingsMockOptions = {},
): FindingsApi & { saveAnalyzerFindings: (analyzer: string, chapterId: string, fresh: Finding[]) => void } {
  let store = wireClone(seed);
  let pendingRerun = options.rerunAfterFirstList === true;
  const find = (id: string): Finding => {
    const finding = store.find((candidate) => candidate.id === id);
    if (!finding) throw new Error('that finding is no longer in this project; reload the list');
    return finding;
  };
  return {
    findingsList: async (query) => {
      validateQuery(query);
      const matched = store
        .filter((finding) => matches(finding, query))
        .sort((a, b) => comparePrimary(a, b, query) || compareText(chapterOf(a), chapterOf(b)) || compareText(a.id, b.id));
      const offset = query.offset ?? 0;
      const end = query.limit ? offset + query.limit : undefined;
      const page = { findings: wireClone(matched.slice(offset, end)), total: matched.length };
      if (pendingRerun) {
        pendingRerun = false;
        store = rerun(store);
      }
      return page;
    },
    findingsGet: async (id) => wireClone(find(id)),
    findingsReview: async ({ id, evidenceVersion, status, note }) => {
      if (!STATUSES.includes(status)) throw new Error(`review status "${status}" is not recognised`);
      if ([...note].length > MAX_REVIEW_NOTE_LENGTH) throw new Error(`a note can be at most ${MAX_REVIEW_NOTE_LENGTH} characters`);
      const current = find(id);
      if ((current.evidence_version ?? '') !== evidenceVersion) {
        throw new Error('this finding changed since it was shown (its analyzer ran again); look at it again before deciding');
      }
      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const decided: Finding = { ...current, review: note ? { status, note, timestamp } : { status, timestamp } };
      store = store.map((finding) => (finding.id === id ? decided : finding));
      return wireClone(decided);
    },
    findingsSummary: async () => summarize(store),
    ...createReaperMock(options.reaper ?? 'connected', find),
    saveAnalyzerFindings: (analyzer, chapterId, fresh) => {
      const kept = store.filter((finding) => finding.analyzer !== analyzer || chapterOf(finding) !== chapterId);
      const decided = new Map(store.map((finding) => [finding.id, finding.review]));
      store = [...kept, ...wireClone(fresh).map((finding) => ({ ...finding, review: decided.get(finding.id) ?? finding.review }))];
    },
  };
}
