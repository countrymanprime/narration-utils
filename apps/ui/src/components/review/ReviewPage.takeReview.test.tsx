// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_FINDINGS, WIRE_TAKE_REVIEW_FINDINGS } from '../../api/mockFixtures';
import { TooltipProvider } from '../primitives/Tooltip';
import type { NarrationApi } from '../../types';
import { ReviewPage } from './ReviewPage';
import { parseTimelineTime } from './TakeReviewScanDialog';

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

// The two take-review groups sit beside the other findings, as a finished scan leaves them.
const withGroups = { findings: [...WIRE_FINDINGS, ...WIRE_TAKE_REVIEW_FINDINGS] };

async function openGroup(user: ReturnType<typeof userEvent.setup>, text: RegExp) {
  const row = (await rows()).find((candidate) => text.test(candidate.textContent ?? ''));
  if (!row) throw new Error(`no row matches ${text}`);
  await user.click(row);
  return screen.findByRole('region', { name: 'Reads' });
}

describe('Find pickups and duplicates on the Review page', () => {
  it('scans the chosen track with real progress, then lists the groups it found, narrowed to take review', async () => {
    const user = userEvent.setup();
    const api = renderPage();
    const start = vi.spyOn(api, 'takeReviewScanStart');
    await rows();

    await user.click(screen.getByRole('button', { name: 'Find pickups and duplicates…' }));
    const form = await screen.findByRole('dialog', { name: 'Find pickups and duplicates' });
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Track to scan' })).toHaveProperty('value', 'Chapter 1'));
    await user.click(within(form).getByRole('button', { name: 'Start scan' }));

    const progress = await screen.findByRole('dialog', { name: 'Finding pickups and duplicates' });
    expect(start).toHaveBeenCalledWith({ chapterTrackName: 'Chapter 1' });
    await waitFor(() => expect(within(progress).getByRole('status').textContent).toBe('Transcribing read 2/4'), { timeout: 3000 });
    await waitFor(() => expect(within(progress).getByRole('status').textContent).toBe('Found 2 groups of repeated reads in Chapter 1.'), { timeout: 5000 });
    await user.click(within(progress).getByRole('button', { name: 'Close' }));

    await waitFor(async () => expect(await rows()).toHaveLength(2));
    expect(screen.getByRole('combobox', { name: 'Check' })).toHaveProperty('value', 'take-review');
    expect((await rows())[0].textContent).toMatch(/2 reads of sentences/);
  }, 15000);

  it('sends a pickup track or a stretch of the timeline with the scan, never both', async () => {
    const user = userEvent.setup();
    const api = renderPage();
    const start = vi.spyOn(api, 'takeReviewScanStart');
    await rows();
    await user.click(screen.getByRole('button', { name: 'Find pickups and duplicates…' }));
    const form = await screen.findByRole('dialog', { name: 'Find pickups and duplicates' });
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Track to scan' })).toHaveProperty('value', 'Chapter 1'));

    await user.selectOptions(within(form).getByRole('combobox', { name: 'Also look for pickups on' }), 'range');
    await user.type(within(form).getByRole('textbox', { name: 'From' }), '30:00');
    await user.type(within(form).getByRole('textbox', { name: 'To' }), '20:00');
    expect(within(form).getByText('The end comes after the start.')).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Start scan' })).toHaveProperty('disabled', true);
    await user.clear(within(form).getByRole('textbox', { name: 'To' }));
    await user.type(within(form).getByRole('textbox', { name: 'To' }), '2400');
    await user.click(within(form).getByRole('button', { name: 'Start scan' }));

    await waitFor(() => expect(start).toHaveBeenCalledWith({ chapterTrackName: 'Chapter 1', pickupRangeStart: 1800, pickupRangeEnd: 2400 }));
  });

  it('shows the host’s refusal of a scope in the form', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: { takeReviewScanStart: () => Promise.reject(new Error('a pickup and duplicate scan is already running')) } });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Find pickups and duplicates…' }));
    const form = await screen.findByRole('dialog', { name: 'Find pickups and duplicates' });
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Track to scan' })).toHaveProperty('value', 'Chapter 1'));
    await user.click(within(form).getByRole('button', { name: 'Start scan' }));
    expect((await within(form).findByRole('alert')).textContent).toContain('already running');
  });

  it('cancels a running scan, and nothing it found is listed', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { takeReviewScanHold: true } });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Find pickups and duplicates…' }));
    const form = await screen.findByRole('dialog', { name: 'Find pickups and duplicates' });
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Track to scan' })).toHaveProperty('value', 'Chapter 1'));
    await user.click(within(form).getByRole('button', { name: 'Start scan' }));

    const progress = await screen.findByRole('dialog', { name: 'Finding pickups and duplicates' });
    expect(within(progress).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('47');
    await user.click(within(progress).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(progress).getByRole('status').textContent).toBe('Scan cancelled. Nothing was saved.'));
    await user.click(within(progress).getByRole('button', { name: 'Close' }));
    expect(await rows()).toHaveLength(4);
  });

  it('shows a scan that is still running when the dialog opens again', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { takeReviewScanHold: true } });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Find pickups and duplicates…' }));
    const form = await screen.findByRole('dialog', { name: 'Find pickups and duplicates' });
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Track to scan' })).toHaveProperty('value', 'Chapter 1'));
    await user.click(within(form).getByRole('button', { name: 'Start scan' }));
    await user.click(await screen.findByRole('button', { name: 'Continue in background' }));

    await user.click(screen.getByRole('button', { name: 'Find pickups and duplicates…' }));
    expect(await screen.findByRole('dialog', { name: 'Finding pickups and duplicates' })).toBeTruthy();
  });

  it('reads a timeline time as seconds, minutes and seconds, or hours too', () => {
    expect(parseTimelineTime('95.5')).toBe(95.5);
    expect(parseTimelineTime('1:35.5')).toBe(95.5);
    expect(parseTimelineTime('1:02:03')).toBe(3723);
    expect(parseTimelineTime('30:00.0')).toBe(1800);
    expect(parseTimelineTime('-5')).toBeUndefined();
    expect(parseTimelineTime('half past')).toBeUndefined();
  });
});

describe('A take-review group on the Review page', () => {
  it('lists every read with where it is, how much it covers and how it matches, and no ranking', async () => {
    const user = userEvent.setup();
    renderPage({ initial: withGroups });
    const reads = await openGroup(user, /Partial pickup/);

    const items = within(reads).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Read 1: ch1_take1.wav');
    expect(items[0].textContent).toContain('Whole span');
    expect(items[1].textContent).toContain('0:10.0 to 0:13.1 in its file');
    expect(items[1].textContent).toContain('Part of the span (70%)');
    expect(reads.textContent).not.toMatch(/best|rank(ed|ing)? (read|take)|score/i);
    // The finding-level REAPER controls are replaced by each read's own.
    expect(screen.queryByRole('region', { name: 'In REAPER' })).toBeNull();
  });

  it('goes to and loops one read in REAPER by its place in the finding', async () => {
    const user = userEvent.setup();
    const api = renderPage({ initial: withGroups });
    const goTo = vi.spyOn(api, 'findingsGoToRead');
    const loop = vi.spyOn(api, 'findingsLoopRead');
    const reads = await openGroup(user, /Partial pickup/);

    await waitFor(() => expect(within(reads).getByRole('button', { name: 'Go to read 2 in REAPER' })).toHaveProperty('disabled', false));
    await user.click(within(reads).getByRole('button', { name: 'Go to read 2 in REAPER' }));
    expect(goTo).toHaveBeenCalledWith(WIRE_TAKE_REVIEW_FINDINGS[0].id, 1);
    expect(await within(reads).findByText('REAPER selected the item and moved the cursor to 0:10.0.')).toBeTruthy();

    await user.click(within(reads).getByRole('button', { name: 'Loop read 1 in REAPER' }));
    expect(loop).toHaveBeenCalledWith(WIRE_TAKE_REVIEW_FINDINGS[0].id, 0);
    expect(await within(reads).findByRole('button', { name: 'Stop loop' })).toBeTruthy();
  });

  it('shows REAPER’s refusal of a read in plain words', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { ...withGroups, reaper: 'stale' } });
    const reads = await openGroup(user, /Partial pickup/);
    await waitFor(() => expect(within(reads).getByRole('button', { name: 'Go to read 1 in REAPER' })).toHaveProperty('disabled', false));
    await user.click(within(reads).getByRole('button', { name: 'Go to read 1 in REAPER' }));
    expect((await within(reads).findByRole('alert')).textContent).toContain('no longer in the REAPER project');
  });

  it('keeps the read controls off with the reason while REAPER is not connected', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { ...withGroups, reaper: 'standalone' } });
    const reads = await openGroup(user, /Partial pickup/);
    await waitFor(() => expect(within(reads).getByText(/open this app from the Narration Utils action in REAPER/)).toBeTruthy());
    expect(within(reads).getByRole('button', { name: 'Go to read 1 in REAPER' })).toHaveProperty('disabled', true);
  });

  it('auditions two reads side by side from their raw source, asking nothing of REAPER', async () => {
    const user = userEvent.setup();
    const createTake = vi.fn();
    renderPage({ overrides: { takeReviewCreateTake: createTake }, initial: withGroups });
    const reads = await openGroup(user, /Partial pickup/);
    await user.click(within(reads).getByRole('button', { name: 'Audition reads' }));
    const dialog = await screen.findByRole('dialog', { name: 'Audition candidate reads' });
    expect(dialog.textContent).toContain('Raw source, no FX or edits applied');
    expect(createTake).not.toHaveBeenCalled();
  });

  it('offers Add as take only once the finding is accepted, then adds the chosen read to the chosen item', async () => {
    const user = userEvent.setup();
    let received: unknown;
    renderPage({
      initial: withGroups,
      overrides: {
        takeReviewCreateTake: async (request) => {
          received = request;
          return { targetItemGuid: request.targetItemGuid, newTakeGuid: '{99999999-0000-4000-8000-000000000099}' };
        },
      },
    });
    let reads = await openGroup(user, /Partial pickup/);
    expect(within(reads).getByRole('button', { name: 'Add as take…' })).toHaveProperty('disabled', true);
    expect(within(reads).getByText(/Accept this finding first/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await screen.findByText('Saved as accepted.');
    reads = screen.getByRole('region', { name: 'Reads' });
    await waitFor(() => expect(within(reads).getByRole('button', { name: 'Add as take…' })).toHaveProperty('disabled', false));
    await user.click(within(reads).getByRole('button', { name: 'Add as take…' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Add candidate as a new take' });
    await user.click(within(dialog).getByRole('button', { name: 'Create take' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Choose a target item and a different candidate read.');
    expect(received).toBeUndefined();

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Target item' }), '{11111111-0000-0000-0000-000000000001}');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Candidate read' }), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Create take' }));

    expect(await within(reads).findByText(/REAPER added read 2 as a new take on read 1's item/)).toBeTruthy();
    expect(received).toEqual({
      findingId: WIRE_TAKE_REVIEW_FINDINGS[0].id,
      targetItemGuid: '{11111111-0000-0000-0000-000000000001}',
      candidateItemGuid: '{11111111-0000-0000-0000-000000000002}',
      sourceFile: 'C:/Projects/Alice-in-Wonderland/media/ch1_take2.wav',
      sourceRangeStart: 10,
      sourceRangeEnd: 13.1,
    });
  });

  it('keeps the take dialog open with REAPER’s reason when adding the take fails', async () => {
    const user = userEvent.setup();
    const accepted = WIRE_TAKE_REVIEW_FINDINGS.map((finding) => ({ ...finding, review: { status: 'accepted' as const } }));
    renderPage({
      initial: { findings: accepted },
      overrides: { takeReviewCreateTake: () => Promise.reject(new Error('the target item is no longer in the REAPER project')) },
    });
    const reads = await openGroup(user, /Partial pickup/);
    await waitFor(() => expect(within(reads).getByRole('button', { name: 'Add as take…' })).toHaveProperty('disabled', false));
    await user.click(within(reads).getByRole('button', { name: 'Add as take…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Add candidate as a new take' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Target item' }), '{11111111-0000-0000-0000-000000000001}');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Candidate read' }), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Create take' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('no longer in the REAPER project');
  });
});
