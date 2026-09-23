import { describe, expect, it } from 'vitest';

import { createFindingsMock } from './findingsMock';
import { WIRE_FINDINGS } from './mockFixtures';

const ids = (findings: { id: string }[]) => findings.map((finding) => finding.id.slice(0, 2));

// WIRE_FINDINGS, by the first two characters of each id:
//   1a chapter-1 t=12.4 conf 0.9 warning   2b chapter-1 t=31.9 conf null error   3c chapter-2 t=8.2 conf 0.2 info (dismissed)
//   4d chapter-1 no time conf null info    5e chapter-2 no time conf 0.3 warning (not in latest run)
describe('the browser mock findings store follows the host rules', () => {
  it('lists the latest run in chapter order by default and hides findings not in it', async () => {
    const page = await createFindingsMock(WIRE_FINDINGS).findingsList({});
    expect(ids(page.findings)).toEqual(['1a', '2b', '4d', '3c']);
    expect(page.total).toBe(4);
  });

  it('sorts each key with a missing value last in either direction', async () => {
    const api = createFindingsMock(WIRE_FINDINGS);
    const all = { includeNotInLatestRun: true } as const;
    expect(ids((await api.findingsList({ ...all, sort: 'time' })).findings)).toEqual(['3c', '1a', '2b', '4d', '5e']);
    expect(ids((await api.findingsList({ ...all, sort: 'time', descending: true })).findings)).toEqual(['2b', '1a', '3c', '4d', '5e']);
    expect(ids((await api.findingsList({ ...all, sort: 'confidence' })).findings)).toEqual(['3c', '5e', '1a', '2b', '4d']);
    expect(ids((await api.findingsList({ ...all, sort: 'severity' })).findings)).toEqual(['2b', '1a', '5e', '4d', '3c']);
    expect(ids((await api.findingsList({ ...all, sort: 'chapter', descending: true })).findings)).toEqual(['3c', '5e', '1a', '2b', '4d']);
  });

  it('filters and pages, reporting the total before paging', async () => {
    const api = createFindingsMock(WIRE_FINDINGS);
    const filtered = await api.findingsList({ analyzer: 'transcript-compare', status: 'unreviewed', minConfidence: 0.5 });
    expect(ids(filtered.findings)).toEqual(['1a']);
    const paged = await api.findingsList({ sort: 'time', offset: 1, limit: 2 });
    expect(ids(paged.findings)).toEqual(['1a', '2b']);
    expect(paged.total).toBe(4);
    expect(ids((await api.findingsList({ chapterId: 'chapter-2', category: 'transcript_discrepancy', severity: 'info' })).findings)).toEqual(['3c']);
  });

  it('records a decision, refuses one on changed evidence, and says when a finding is gone', async () => {
    const api = createFindingsMock(WIRE_FINDINGS);
    const [first] = WIRE_FINDINGS;
    await expect(api.findingsReview({ id: first.id, evidenceVersion: 'stale', status: 'accepted', note: '' })).rejects.toThrow('changed');
    const decided = await api.findingsReview({ id: first.id, evidenceVersion: first.evidence_version ?? '', status: 'accepted', note: '' });
    expect(decided.review.status).toBe('accepted');
    expect(decided.review.note).toBeUndefined();
    expect(decided.review.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect((await api.findingsGet(first.id)).review.status).toBe('accepted');
    await expect(api.findingsGet('missing')).rejects.toThrow('no longer');
    expect(WIRE_FINDINGS[0].review.status).toBe('unreviewed');
  });

  it('summarizes the latest run by status and lists every facet', async () => {
    const summary = await createFindingsMock(WIRE_FINDINGS).findingsSummary();
    expect(summary).toEqual({
      total: 4,
      unreviewed: 3,
      accepted: 0,
      dismissed: 1,
      deferred: 0,
      notInLatestRun: 1,
      analyzers: ['story-bible', 'transcript-compare'],
      categories: ['entity', 'pronunciation', 'transcript_discrepancy'],
      chapters: [
        { id: 'chapter-1', title: 'Chapter 1' },
        { id: 'chapter-2', title: 'Chapter 2' },
      ],
    });
    expect(await createFindingsMock([]).findingsSummary()).toMatchObject({ total: 0, analyzers: [], chapters: [] });
  });
});
