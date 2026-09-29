// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';
import { TooltipProvider } from '../primitives/Tooltip';
import type { Finding, NarrationApi, ReaperStatus, WorkspaceAlignmentResult } from '../../types';
import { TakesPanel } from './TakesPanel';

// The players own real <audio> elements; jsdom has no HTMLMediaElement.play().
class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  constructor() {
    super();
    FakeAudio.instances.push(this);
  }
}

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CONNECTED: ReaperStatus = { connection: 'connected' };

/** The mock's measured chapter, linked to the fixture project's track so its first item is live. */
async function linkedApi(
  initial: Parameters<typeof createMockApi>[1] = {},
): Promise<{ api: NarrationApi; chapterId: string; alignment: WorkspaceAlignmentResult }> {
  const chapters = await createMockApi().manuscriptChapters();
  const measured = chapters.find((chapter) => chapter.recordedFraction !== undefined);
  if (!measured) throw new Error('the mock chapters carry a measured recordedFraction');
  const [track] = WIRE_TRACKS_PROJECT.tracks;
  const api = createMockApi(
    {},
    {
      chapterTrackMappings: [
        { trackGuid: track.guid, chapterId: measured.id, chapterTitle: measured.title, confirmedAt: '2026-09-24T09:00:00Z', origin: 'manual', match: null },
      ],
      ...initial,
    },
  );
  return { api, chapterId: measured.id, alignment: await api.workspaceAlignment(measured.id) };
}

/** The page's own wiring of the panel: the chapter's findings are read here and again when a comparison saves one, and the full comparison has a place to be drawn. */
function Harness({
  api,
  chapterId,
  alignment,
  reaper = CONNECTED,
  currentToken,
}: {
  api: NarrationApi;
  chapterId: string;
  alignment: WorkspaceAlignmentResult;
  reaper?: ReaperStatus;
  currentToken?: number;
}) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [detail, setDetail] = useState<HTMLElement | null>(null);
  const load = useCallback(() => void api.findingsList({ chapterId }).then((page) => setFindings(page.findings)), [api, chapterId]);
  useEffect(load, [load]);
  return (
    <>
      <TakesPanel
        chapterId={chapterId}
        alignment={alignment}
        currentToken={currentToken}
        findings={findings}
        reaper={reaper}
        onReaperStatusChange={async () => {}}
        onFindingsChanged={load}
        detailTarget={detail}
      />
      <div ref={setDetail} data-testid="comparison-detail" />
    </>
  );
}

async function renderPanel(options: { reaper?: ReaperStatus; initial?: Parameters<typeof createMockApi>[1]; currentToken?: number } = {}) {
  const { api, chapterId, alignment } = await linkedApi(options.initial);
  render(
    <ApiProvider api={api}>
      <TooltipProvider>
        <Harness api={api} chapterId={chapterId} alignment={alignment} reaper={options.reaper} currentToken={options.currentToken} />
      </TooltipProvider>
    </ApiProvider>,
  );
  return { api, chapterId, alignment };
}

const takesList = () => screen.findByRole('list', { name: 'Takes of this passage' });

describe('the Takes panel (edit-and-proof-workspace PRD Phase 6, mock 04-takes-panel-ab)', () => {
  it('opens on the first paragraph heard and lists every take with where it came from and which one plays', async () => {
    const { api } = await renderPanel();
    const read = vi.spyOn(api, 'workspaceTakes');

    const list = await takesList();

    expect(read).not.toHaveBeenCalled(); // the spy is set after the first read: the panel asked once, on its own
    expect(screen.getByRole('heading', { name: 'Takes · 4 alternates' })).toBeTruthy();
    expect(screen.getByText('Evidence per word, never a score.')).toBeTruthy();
    expect(screen.getByText(/^¶1 · \d+ words$/)).toBeTruthy();
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText('Plays now')).toBeTruthy();
    expect(within(rows[0]).getByText(/^This item · active take/)).toBeTruthy();
    expect(within(rows[2]).getByText(/^Retake on another lane/)).toBeTruthy();
    expect(within(rows[3]).getByText(/^Read from Find pickups/)).toBeTruthy();
    expect(within(rows[1]).getByText(/^Not compared yet: comparing transcribes it/)).toBeTruthy();
    // Nothing ranks them.
    expect(screen.queryByText(/best|score:|rank/i)).toBeNull();
  });

  it('makes another take of the item active in one request, and shows it playing in REAPER', async () => {
    const user = userEvent.setup();
    const { api } = await renderPanel();
    const useTake = vi.spyOn(api, 'workspaceUseTake');
    const list = await takesList();

    await user.click(within(list).getByRole('button', { name: 'Use take 2' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/Made that take active in REAPER, in one undo step/);
    expect(useTake).toHaveBeenCalledTimes(1);
    expect(useTake.mock.calls[0][3]).toMatch(/^take:/);
    await waitFor(() =>
      expect(within(within(screen.getByRole('list', { name: 'Takes of this passage' })).getAllByRole('listitem')[1]).getByText('Plays now')).toBeTruthy(),
    );
  });

  it('adds a read from another item and makes it active only after a confirm', async () => {
    const user = userEvent.setup();
    const { api } = await renderPanel();
    const useTake = vi.spyOn(api, 'workspaceUseTake');
    const list = await takesList();

    await user.click(within(list).getByRole('button', { name: /^Use pickup read/ }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Add this read and make it active' });
    expect(useTake).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(useTake).not.toHaveBeenCalled();

    await user.click(within(list).getByRole('button', { name: /^Use pickup read/ }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Add and make active' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/Added the read as a new take and made it active/);
    expect(useTake).toHaveBeenCalledTimes(1);
  });

  it('starts a lane pick and says it is asking REAPER', async () => {
    const user = userEvent.setup();
    await renderPanel();
    const list = await takesList();

    await user.click(within(list).getByRole('button', { name: /^Use retake on lane 2/ }));

    expect((await screen.findByRole('status')).textContent).toMatch(/Asking REAPER to play this retake/);
  });

  it('cannot use a take while REAPER is not connected, says why, and still lets the narrator hear them', async () => {
    const user = userEvent.setup();
    await renderPanel({ reaper: { connection: 'standalone', message: 'REAPER is not connected to this app.' } });
    const list = await takesList();

    const use = within(list).getByRole('button', { name: 'Use take 2' });
    expect(use.hasAttribute('disabled') || use.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(screen.getByText(/Use this take needs REAPER\. REAPER is not connected to this app\./)).toBeTruthy();
    await user.click(within(list).getByRole('button', { name: 'Play take 2' }));
    expect(within(list).getByRole('button', { name: 'Pause take 2' })).toBeTruthy();
  });

  it("shows the host's refusal in its own words when REAPER refuses", async () => {
    const user = userEvent.setup();
    await renderPanel({ initial: { reaper: 'recording' } });
    const list = await takesList();

    await user.click(within(list).getByRole('button', { name: 'Use take 2' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/REAPER is recording, so nothing was changed/);
  });

  it('plays one take at a time in One mode, from its own recording', async () => {
    const user = userEvent.setup();
    await renderPanel();
    const list = await takesList();

    await user.click(within(list).getByRole('button', { name: 'Play take 1' }));
    expect(within(list).getByRole('button', { name: 'Pause take 1' })).toBeTruthy();
    await user.click(within(list).getByRole('button', { name: 'Play take 2' }));

    expect(within(list).getByRole('button', { name: 'Pause take 2' })).toBeTruthy();
    expect(within(list).queryByRole('button', { name: 'Pause take 1' })).toBeNull();
    expect(within(list).getByRole('button', { name: 'Play take 1' })).toBeTruthy();
    expect(FakeAudio.instances.filter((audio) => audio.play.mock.calls.length > 0)).toHaveLength(1); // one player plays each take in turn
    expect(screen.queryByRole('button', { name: 'Swap A and B' })).toBeNull();
  });

  it('puts two takes in slots A and B and swaps between them at the same word', async () => {
    const user = userEvent.setup();
    await renderPanel();
    const list = await takesList();
    await user.click(screen.getByRole('button', { name: 'A/B' }));
    expect(screen.getByText('Swap switches A and B at the same word')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Swap A and B' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(list).getByRole('button', { name: 'Play take 1' }));
    await user.click(within(list).getByRole('button', { name: 'Play take 2' }));

    const slotA = screen.getByLabelText('Slot A');
    const slotB = screen.getByLabelText('Slot B');
    expect(slotA.closest('li')?.textContent).toMatch(/Take 1/);
    expect(slotB.closest('li')?.textContent).toMatch(/Take 2/);
    // Take 2 (B) plays now; swapping stops it and plays Take 1 (A) instead.
    expect(within(list).getByRole('button', { name: 'Pause take 2' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Swap A and B' }));
    expect(within(list).getByRole('button', { name: 'Pause take 1' })).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Play take 2' })).toBeTruthy();
  });

  it('compares the takes with real progress, then says on each card how it read the passage, and draws the full comparison below', async () => {
    const user = userEvent.setup();
    const { api } = await renderPanel();
    const start = vi.spyOn(api, 'workspaceTakesCompareStart');
    const list = await takesList();

    await user.click(within(list).getAllByRole('button', { name: 'Compare' })[0]);
    const progress = await screen.findByRole('dialog', { name: 'Comparing takes' });
    expect(start).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(progress).getByRole('status').textContent).toMatch(/^Compared the takes/), { timeout: 6000 });
    await user.click(within(progress).getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(
        within(within(screen.getByRole('list', { name: 'Takes of this passage' })).getAllByRole('listitem')[0]).getByText(/Every word matched/),
      ).toBeTruthy(),
    );
    const rows = within(screen.getByRole('list', { name: 'Takes of this passage' })).getAllByRole('listitem');
    expect(within(rows[1]).getByText(/Misread “\w+” as “remarkably”/)).toBeTruthy();
    expect(within(screen.getByTestId('comparison-detail')).getByRole('region', { name: 'Takes side by side' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
  }, 20000);

  it('says why there are no takes for a paragraph nothing was heard on, and offers the paragraph at the playhead', async () => {
    const user = userEvent.setup();
    const { alignment } = await linkedApi();
    const unheard = alignment.tokens.findIndex((token) => token.item === undefined && token.p !== undefined);
    if (unheard < 0) return; // the mock chapter heard everything: nothing to say
    await renderPanel({ currentToken: unheard });
    // The panel opens on the first paragraph heard, so moving the playhead to the unheard one offers it.
    await user.click(await screen.findByRole('button', { name: 'Show takes for the paragraph at the playhead' }));
    expect(await screen.findByText(/wasn't heard in the recording/)).toBeTruthy();
  });
});
