// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_FINDINGS, WIRE_TAKE_REVIEW_FINDINGS, wireClone } from '../../api/mockFixtures';
import { WIRE_TAKE_COMPARISON_FINDING } from '../../api/takeComparisonMock';
import { takeComparisonEvidenceSchema } from '../../api/schemas/takeReview';
import { TooltipProvider } from '../primitives/Tooltip';
import type { Finding, NarrationApi } from '../../types';
import { ReviewPage } from './ReviewPage';
import { divergenceLabel, metricValue, scriptSummary } from './takeComparisonFormat';

// The audition dialog owns real <audio> elements; jsdom has no HTMLMediaElement.play().
class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
}

beforeEach(() => vi.stubGlobal('Audio', FakeAudio));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Initial = Parameters<typeof createMockApi>[1];

function renderPage({ overrides = {}, initial = {} }: { overrides?: Partial<NarrationApi>; initial?: Initial } = {}) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <TooltipProvider>
        <ReviewPage notify={vi.fn()} hasManuscript goToManuscript={vi.fn()} goToStoryBible={vi.fn()} />
      </TooltipProvider>
    </ApiProvider>,
  );
  return api;
}

const rows = async () => {
  const table = await screen.findByRole('table', { name: 'Findings' });
  await waitFor(() => expect(within(table).queryAllByRole('row').length).toBeGreaterThan(1));
  return within(table).getAllByRole('row').slice(1);
};

async function openRow(user: ReturnType<typeof userEvent.setup>, text: RegExp) {
  const row = (await rows()).find((candidate) => text.test(candidate.textContent ?? ''));
  if (!row) throw new Error(`no row matches ${text}`);
  await user.click(row);
}

const evidenceOf = (finding: Finding) => takeComparisonEvidenceSchema.parse(finding.evidence);

describe('Compare takes on the Review page', () => {
  it('compares a group with real progress, then opens the comparison, narrowed to take comparisons', async () => {
    const user = userEvent.setup();
    const api = renderPage({ initial: { findings: [...WIRE_FINDINGS, ...WIRE_TAKE_REVIEW_FINDINGS] } });
    const start = vi.spyOn(api, 'takeComparisonStart');
    await openRow(user, /Partial pickup/);
    const reads = await screen.findByRole('region', { name: 'Reads' });

    await user.click(within(reads).getByRole('button', { name: 'Compare takes…' }));
    const progress = await screen.findByRole('dialog', { name: 'Comparing takes' });
    expect(start).toHaveBeenCalledWith(WIRE_TAKE_REVIEW_FINDINGS[0].id);
    await waitFor(() => expect(within(progress).getByRole('status').textContent).toBe('Transcribing take 2/2'), { timeout: 3000 });
    await waitFor(() => expect(within(progress).getByRole('status').textContent).toMatch(/^Compared the takes/), { timeout: 5000 });
    await user.click(within(progress).getByRole('button', { name: 'Close' }));

    const comparison = await screen.findByRole('region', { name: 'Takes side by side' });
    expect(screen.getByRole('combobox', { name: 'Check' })).toHaveProperty('value', 'take-comparison');
    expect((await rows())[0].textContent).toMatch(/2 reads of sentences 4–8, side by side/);
    expect(within(comparison).getByText(/7 of 11 words as written · 1 misread · 3 not reached/)).toBeTruthy();
    expect(within(comparison).getByRole('list', { name: 'Where read 2 departs from the script' }).textContent).toMatch(/Misread “very” as “remarkably”/);
  }, 15000);

  it('sets each category side by side for every read and never ranks them', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { findings: [WIRE_TAKE_COMPARISON_FINDING] } });
    await openRow(user, /side by side/);
    const comparison = await screen.findByRole('region', { name: 'Takes side by side' });

    const table = within(comparison).getByRole('table', { name: 'The audio of each read' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Evidence', 'Read 1', 'Read 2']);
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0].textContent),
    ).toEqual([
      expect.stringMatching(/^Clipping/),
      expect.stringMatching(/^Room noise/),
      expect.stringMatching(/^Level/),
      expect.stringMatching(/^Length/),
      expect.stringMatching(/^Pauses/),
    ]);
    const noise = within(table).getByRole('row', { name: /Room noise/ });
    expect(noise.textContent).toContain('-47.6 dBFS');
    expect(noise.textContent).toContain('-68.9 dBFS');
    expect(within(table).getByRole('row', { name: /Level/ }).textContent).toContain('Unavailable: no neighbouring item has a measurable integrated loudness');
    // The narrator chooses: nothing says which read is better (Q9), and the app never makes a take active (Q8).
    expect(comparison.textContent).not.toMatch(/\b(best|winner|rank|score|recommended)\b/i);
    expect(within(comparison).queryByRole('button', { name: /active/i })).toBeNull();
    expect(within(comparison).getByText(/choose the take you want in REAPER/)).toBeTruthy();
  });

  it('marks the words a read departs on, for the eye and for a screen reader', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { findings: [WIRE_TAKE_COMPARISON_FINDING] } });
    await openRow(user, /side by side/);
    const comparison = await screen.findByRole('region', { name: 'Takes side by side' });
    const [first, second] = within(comparison)
      .getAllByRole('listitem')
      .filter((item) => /^Read \d/.test(item.textContent ?? ''));
    expect(first.textContent).not.toMatch(/\((misread|not reached|left out)\)/);
    expect(second.textContent).toContain('very (misread)');
    expect(second.textContent).toContain('Alice (not reached)');
  });

  it('shows why a read was not compared, and measures only the reads that were', async () => {
    const user = userEvent.setup();
    const finding = wireClone(WIRE_TAKE_COMPARISON_FINDING);
    const evidence = evidenceOf(finding);
    evidence.members[1] = {
      ...evidence.members[1],
      compared: false,
      not_compared_reason: "This read's item was moved or trimmed since the chapter was scanned, so it may not hold the same words. Scan the chapter again.",
      fidelity: null,
      counts: null,
      words: [],
      divergences: [],
      metrics: null,
    };
    evidence.compared = 1;
    renderPage({ initial: { findings: [{ ...finding, evidence }] } });
    await openRow(user, /side by side/);
    const comparison = await screen.findByRole('region', { name: 'Takes side by side' });
    expect(within(comparison).getByText(/moved or trimmed since the chapter was scanned/)).toBeTruthy();
    const table = within(comparison).getByRole('table', { name: 'The audio of each read' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Evidence', 'Read 1']);
  });

  it('goes to and loops one read in REAPER by its index', async () => {
    const user = userEvent.setup();
    const api = renderPage({ initial: { findings: [WIRE_TAKE_COMPARISON_FINDING] } });
    const goTo = vi.spyOn(api, 'findingsGoToRead');
    const loop = vi.spyOn(api, 'findingsLoopRead');
    await openRow(user, /side by side/);
    const comparison = await screen.findByRole('region', { name: 'Takes side by side' });
    await waitFor(() => expect(within(comparison).getByRole('button', { name: 'Go to read 2 in REAPER' })).toHaveProperty('disabled', false));
    await user.click(within(comparison).getByRole('button', { name: 'Go to read 2 in REAPER' }));
    expect(goTo).toHaveBeenCalledWith(WIRE_TAKE_COMPARISON_FINDING.id, 1);
    await user.click(within(comparison).getByRole('button', { name: 'Loop read 1 in REAPER' }));
    expect(loop).toHaveBeenCalledWith(WIRE_TAKE_COMPARISON_FINDING.id, 0);
    await within(comparison).findByRole('button', { name: 'Stop loop' });
    await user.click(within(comparison).getByRole('button', { name: 'Audition reads' }));
    expect(await screen.findByRole('dialog', { name: 'Audition candidate reads' })).toBeTruthy();
  });

  it('says why a comparison could not start, in the host words', async () => {
    const user = userEvent.setup();
    renderPage({
      initial: { findings: WIRE_TAKE_REVIEW_FINDINGS },
      overrides: {
        takeComparisonStart: () => Promise.reject(new Error('no chapter of the manuscript is titled "Chapter 1" any more; scan the chapter again')),
      },
    });
    await openRow(user, /Partial pickup/);
    await user.click(within(await screen.findByRole('region', { name: 'Reads' })).getByRole('button', { name: 'Compare takes…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Compare takes' });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/The takes were not compared: no chapter of the manuscript is titled "Chapter 1"/);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not pass off a running comparison of another group as this one', async () => {
    const user = userEvent.setup();
    const api = renderPage({ initial: { findings: WIRE_TAKE_REVIEW_FINDINGS, takeComparisonHold: true } });
    await api.takeComparisonStart(WIRE_TAKE_REVIEW_FINDINGS[1].id);
    const start = vi.spyOn(api, 'takeComparisonStart');
    await openRow(user, /Partial pickup/);
    await user.click(within(await screen.findByRole('region', { name: 'Reads' })).getByRole('button', { name: 'Compare takes…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Compare takes' });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/the takes of another group are being compared/);
    expect(start).not.toHaveBeenCalled();
  });

  it('cancels a running comparison and saves nothing', async () => {
    const user = userEvent.setup();
    const api = renderPage({ initial: { findings: WIRE_TAKE_REVIEW_FINDINGS, takeComparisonHold: true } });
    await openRow(user, /Partial pickup/);
    await user.click(within(await screen.findByRole('region', { name: 'Reads' })).getByRole('button', { name: 'Compare takes…' }));
    const progress = await screen.findByRole('dialog', { name: 'Comparing takes' });
    await user.click(await within(progress).findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(progress).getByRole('status').textContent).toBe('Comparison cancelled. Nothing was saved.'));
    expect((await api.findingsList({ analyzer: 'take-comparison' })).findings).toHaveLength(0);
  });
});

describe('how a take comparison is worded', () => {
  const [clean, flawed] = evidenceOf(WIRE_TAKE_COMPARISON_FINDING).members;

  it('summarises how a read read the script, and each place it departs', () => {
    expect(scriptSummary(clean, 11)).toBe('11 of 11 words as written');
    expect(scriptSummary(flawed, 11)).toBe('7 of 11 words as written · 1 misread · 3 not reached');
    expect(scriptSummary({ ...flawed, counts: null }, 19)).toBe('Not compared');
    expect(scriptSummary({ ...flawed, counts: { matched: 1, misread: 0, skipped: 2, unread: 0, extra_words: 1 } }, 3)).toBe(
      '1 of 3 words as written · 2 left out · 1 extra word',
    );
    expect(divergenceLabel(flawed.divergences[0])).toMatch(/^Misread “very” as “remarkably” at 0:1/);
    expect(divergenceLabel(flawed.divergences[1])).toBe('Not reached: “nor did Alice”');
    expect(divergenceLabel({ ...flawed.divergences[0], kind: 'extra', audio_text: 'um', start: 2 })).toBe('Extra words “um” at 0:02.0');
    expect(divergenceLabel({ ...flawed.divergences[0], kind: 'skipped', manuscript_text: 'so', start: null })).toBe('Left out: “so”');
  });

  it('words each category, and an unavailable one with its reason', () => {
    const metrics = clean.metrics;
    if (!metrics || !flawed.metrics) throw new Error('the fixture reads are measured');
    expect(metricValue(metrics, 'clipping').text).toBe('None at full scale');
    expect(metricValue(flawed.metrics, 'clipping').text).toBe('7 samples at full scale, 2 runs');
    expect(metricValue(metrics, 'level_consistency').text).toBe('-18.6 LUFS, 0.4 LU louder than its neighbours');
    const quieter = { ...flawed.metrics.level_consistency, status: 'measured' as const, delta_lu: -2.1 };
    expect(metricValue({ ...flawed.metrics, level_consistency: quieter }, 'level_consistency').text).toBe('-21.1 LUFS, 2.1 LU quieter than its neighbours');
    expect(metricValue({ ...metrics, level_consistency: { ...metrics.level_consistency, delta_lu: 0.01 } }, 'level_consistency').text).toMatch(/the same as/);
    expect(metricValue({ ...metrics, level_consistency: { ...metrics.level_consistency, delta_lu: null } }, 'level_consistency')).toEqual({
      text: 'Not measured',
      unavailable: true,
    });
    expect(metricValue(metrics, 'duration').text).toBe('4.5 s, 169 words a minute');
    expect(metricValue({ ...metrics, duration: { ...metrics.duration, item_seconds: null, words_per_minute: null } }, 'duration').text).toBe('No length');
    expect(metricValue(metrics, 'pause_profile').text).toBe('1 pause, longest 0.6 s');
    expect(metricValue({ ...metrics, pause_profile: { ...metrics.pause_profile, count: 0 } }, 'pause_profile').text).toBe('No pauses');
    expect(metricValue({ ...metrics, noise: { ...metrics.noise, noise_floor_dbfs: null } }, 'noise').text).toBe('No quiet stretch to measure');
    expect(metricValue(flawed.metrics, 'level_consistency')).toEqual({
      text: 'Unavailable: no neighbouring item has a measurable integrated loudness',
      unavailable: true,
    });
    expect(metricValue(flawed.metrics, 'pause_profile').text).toBe('No pauses');
    expect(metricValue({ ...metrics, noise: { ...metrics.noise, status: 'unavailable' } }, 'noise').text).toBe('Unavailable: not measured');
  });
});
