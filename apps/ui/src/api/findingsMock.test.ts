import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { approvedMarkerName, createFindingsMock, REAPER_MESSAGES } from './findingsMock';
import { WIRE_FINDINGS } from './mockFixtures';
import { FINDING_CATEGORIES } from './contracts/findings';

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

  // Query.Validate (apps/desktop/internal/findings/query.go): a query the host would refuse is refused here too, so the mock
  // cannot hide a page that sends one.
  it.each([
    [{ category: 'typo' }, 'category'],
    [{ severity: 'fatal' as never }, 'severity'],
    [{ status: 'done' as never }, 'review status'],
    [{ sort: 'name' as never }, 'sort'],
    [{ minConfidence: 1.5 }, 'minimum confidence'],
    [{ minConfidence: -0.1 }, 'minimum confidence'],
    [{ minConfidence: Number.NaN }, 'minimum confidence'],
    [{ limit: -1 }, 'limit'],
    [{ offset: -1 }, 'offset'],
  ])('refuses the query %o the host refuses', async (query, field) => {
    await expect(createFindingsMock(WIRE_FINDINGS).findingsList(query)).rejects.toThrow(field);
  });

  it('accepts every documented category and the edges of the confidence range', async () => {
    const api = createFindingsMock(WIRE_FINDINGS);
    for (const category of FINDING_CATEGORIES) await expect(api.findingsList({ category })).resolves.toBeDefined();
    await expect(api.findingsList({ minConfidence: 0 })).resolves.toBeDefined();
    await expect(api.findingsList({ minConfidence: 1 })).resolves.toBeDefined();
  });

  it('refuses a decision the host refuses: an unknown status or a note over the limit', async () => {
    const api = createFindingsMock(WIRE_FINDINGS);
    const [first] = WIRE_FINDINGS;
    const request = { id: first.id, evidenceVersion: first.evidence_version ?? '', note: '' };
    await expect(api.findingsReview({ ...request, status: 'done' as never })).rejects.toThrow('review status');
    await expect(api.findingsReview({ ...request, status: 'accepted', note: 'x'.repeat(2001) })).rejects.toThrow('at most 2000');
    await expect(api.findingsReview({ ...request, status: 'accepted', note: 'x'.repeat(2000) })).resolves.toBeDefined();
  });

  it('with rerunAfterFirstList, the analyzer runs again once the page has listed, so the first decision is refused', async () => {
    const api = createFindingsMock(WIRE_FINDINGS, { rerunAfterFirstList: true });
    const [shown] = (await api.findingsList({})).findings;
    await expect(api.findingsReview({ id: shown.id, evidenceVersion: shown.evidence_version ?? '', status: 'accepted', note: '' })).rejects.toThrow('changed');
    const fresh = await api.findingsGet(shown.id);
    expect(fresh.evidence_version).not.toBe(shown.evidence_version);
    await expect(api.findingsReview({ id: fresh.id, evidenceVersion: fresh.evidence_version ?? '', status: 'accepted', note: '' })).resolves.toMatchObject({
      review: { status: 'accepted' },
    });
  });
});

// The mock's REAPER (review dashboard Phase 7) answers Go to, Loop and Stop in the host's order and words, so the Review page
// built against it says what the app says.
describe("the browser mock's REAPER follows the host's navigation rules", () => {
  const golden = (file: string): { message?: string } =>
    JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/contracts/${file}`, import.meta.url)), 'utf8'));

  it('uses the words the host sends, as its golden payloads pin them', () => {
    expect(REAPER_MESSAGES.stale).toBe(golden('findings-navigation-stale.json').message);
    expect(REAPER_MESSAGES.recording).toBe(golden('findings-navigation-recording.json').message);
    expect(REAPER_MESSAGES.noItem).toBe(golden('findings-navigation-no-item.json').message);
    expect(REAPER_MESSAGES.notRunning).toBe(golden('findings-navigation-not-running.json').message);
    expect(REAPER_MESSAGES.notRunning).toBe(golden('findings-reaper-status-not-running.json').message);
    expect(REAPER_MESSAGES.standalone).toBe(golden('findings-reaper-status-standalone.json').message);
  });

  it('goes to and loops a finding with an item, and Stop puts back what the loop changed', async () => {
    const api = createFindingsMock(WIRE_FINDINGS);
    await expect(api.findingsGoTo('1a2b3c4d5e6f708192a3b4c5')).resolves.toEqual({ outcome: 'navigated', projectTime: 12.4 });
    await expect(api.findingsLoop('1a2b3c4d5e6f708192a3b4c5')).resolves.toEqual({ outcome: 'looping', loopStart: 10.4, loopEnd: 14.4 });
    await expect(api.findingsReaperStatus()).resolves.toEqual({ connection: 'connected', loopingFindingId: '1a2b3c4d5e6f708192a3b4c5' });
    await expect(api.findingsStopLoop()).resolves.toEqual({ outcome: 'stopped', restored: 3, kept: 0 });
    await expect(api.findingsReaperStatus()).resolves.toEqual({ connection: 'connected' });
    await expect(api.findingsStopLoop()).resolves.toEqual({ outcome: 'stopped', restored: 0, kept: 0 });
  });

  it('refuses a finding with no item before it looks at REAPER, and a gone finding is an error', async () => {
    const api = createFindingsMock(WIRE_FINDINGS, { reaper: 'standalone' });
    await expect(api.findingsGoTo('3c4d5e6f708192a3b4c5d6e7')).resolves.toMatchObject({ outcome: 'refused', reason: 'no_item' });
    await expect(api.findingsGoTo('missing')).rejects.toThrow('no longer in this project');
  });

  it('refuses every action for the mode it is in, and a refused loop starts nothing', async () => {
    const reasons = [
      ['standalone', 'standalone'],
      ['not-running', 'not_running'],
      ['stale', 'stale'],
      ['recording', 'recording'],
      ['outdated', 'script_outdated'],
    ] as const;
    for (const [reaper, reason] of reasons) {
      const api = createFindingsMock(WIRE_FINDINGS, { reaper });
      await expect(api.findingsGoTo('1a2b3c4d5e6f708192a3b4c5')).resolves.toMatchObject({ outcome: 'refused', reason });
      await expect(api.findingsLoop('1a2b3c4d5e6f708192a3b4c5')).resolves.toMatchObject({ outcome: 'refused', reason });
      expect((await api.findingsReaperStatus()).loopingFindingId).toBeUndefined();
    }
  });
});

// The approved marker (review dashboard Phase 8): only an accepted finding gets one, in the host's order and words.
describe("the browser mock's REAPER adds an approved marker as the host does", () => {
  const golden = (file: string): { message?: string; name?: string } =>
    JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/contracts/${file}`, import.meta.url)), 'utf8'));
  const accept = async (api: ReturnType<typeof createFindingsMock>, id: string) => {
    const finding = await api.findingsGet(id);
    await api.findingsReview({ id, evidenceVersion: finding.evidence_version ?? '', status: 'accepted', note: '' });
  };

  it('uses the words the host sends, as its golden payloads pin them', () => {
    expect(REAPER_MESSAGES.notAccepted).toBe(golden('findings-add-marker-not-accepted.json').message);
    expect(REAPER_MESSAGES.markerStale).toBe(golden('findings-add-marker-stale.json').message);
  });

  it('names the marker the way the host does', () => {
    const [misread, skipped, extra, entity] = WIRE_FINDINGS;
    expect(approvedMarkerName(misread)).toBe("MISREAD: 'a White Rabbit with pink eyes' as 'a white rabbit with pale eyes'");
    expect(approvedMarkerName(skipped)).toBe("SKIPPED: 'Oh dear!'");
    expect(approvedMarkerName(extra)).toBe("EXTRA: 'and then'");
    expect(approvedMarkerName(entity)).toBe("ENTITY: 'White Rabbit'");
    expect(approvedMarkerName({ ...misread, manuscript: { expected: 'one two three four five six seven eight nine' } })).toBe(
      "MISREAD: 'one two three four five six seven eight ...'",
    );
  });

  it('refuses a finding that is not accepted, then adds the marker once and says the second is already there', async () => {
    const api = createFindingsMock(WIRE_FINDINGS);
    await expect(api.findingsAddMarker('1a2b3c4d5e6f708192a3b4c5')).resolves.toMatchObject({ outcome: 'refused', reason: 'not_accepted' });
    await accept(api, '1a2b3c4d5e6f708192a3b4c5');
    await expect(api.findingsAddMarker('1a2b3c4d5e6f708192a3b4c5')).resolves.toEqual({
      outcome: 'added',
      name: "MISREAD: 'a White Rabbit with pink eyes' as 'a white rabbit with pale eyes'",
      sourceTime: 12.4,
    });
    await expect(api.findingsAddMarker('1a2b3c4d5e6f708192a3b4c5')).resolves.toMatchObject({ outcome: 'existing' });
  });

  it('refuses an accepted finding with no item, and every REAPER mode that cannot add it', async () => {
    const older = createFindingsMock(WIRE_FINDINGS);
    await accept(older, '3c4d5e6f708192a3b4c5d6e7');
    await expect(older.findingsAddMarker('3c4d5e6f708192a3b4c5d6e7')).resolves.toMatchObject({ outcome: 'refused', reason: 'no_item' });
    const reasons = [
      ['standalone', 'standalone'],
      ['not-running', 'not_running'],
      ['stale', 'stale'],
      ['recording', 'recording'],
      ['outdated', 'script_outdated'],
    ] as const;
    for (const [reaper, reason] of reasons) {
      const api = createFindingsMock(WIRE_FINDINGS, { reaper });
      await accept(api, '1a2b3c4d5e6f708192a3b4c5');
      await expect(api.findingsAddMarker('1a2b3c4d5e6f708192a3b4c5')).resolves.toMatchObject({ outcome: 'refused', reason });
    }
  });
});
