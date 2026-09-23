// The browser mock's findings store, answering the review bindings the way apps/desktop/internal/findings does:
// the same filters, sort keys (a missing value sorts last either way), ties by chapter then id, paging with the
// total before paging, counts over the latest run, and a decision refused when the evidence changed (ADR 0120).
// It exists so the Review page can be built and screenshotted without a host; the host's rules are the ones that
// count, and apps/desktop/internal/findings/query_test.go pins them.
import type { Finding, FindingsApi, FindingsQuery, FindingsSummary, FindingSeverity } from '../types';
import { wireClone } from './mockFixtures';

const SEVERITY_ORDER: FindingSeverity[] = ['error', 'warning', 'info'];

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

export function createFindingsMock(seed: Finding[]): FindingsApi {
  let store = wireClone(seed);
  const find = (id: string): Finding => {
    const finding = store.find((candidate) => candidate.id === id);
    if (!finding) throw new Error('that finding is no longer in this project; reload the list');
    return finding;
  };
  return {
    findingsList: async (query) => {
      const matched = store
        .filter((finding) => matches(finding, query))
        .sort((a, b) => comparePrimary(a, b, query) || compareText(chapterOf(a), chapterOf(b)) || compareText(a.id, b.id));
      const offset = query.offset ?? 0;
      const end = query.limit ? offset + query.limit : undefined;
      return { findings: wireClone(matched.slice(offset, end)), total: matched.length };
    },
    findingsGet: async (id) => wireClone(find(id)),
    findingsReview: async ({ id, evidenceVersion, status, note }) => {
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
  };
}
