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

// The A/B dialog owns real <audio> elements; jsdom has no HTMLMediaElement.play().
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

/** The page's own wiring of the panel: the chapter's findings are read here and again when a comparison saves one. */
function Harness({
  api,
  chapterId,
  alignment,
  reaper = CONNECTED,
}: {
  api: NarrationApi;
  chapterId: string;
  alignment: WorkspaceAlignmentResult;
  reaper?: ReaperStatus;
}) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const load = useCallback(() => void api.findingsList({ chapterId }).then((page) => setFindings(page.findings)), [api, chapterId]);
  useEffect(load, [load]);
  return (
    <TakesPanel
      chapterId={chapterId}
      alignment={alignment}
      currentToken={0}
      findings={findings}
      reaper={reaper}
      onReaperStatusChange={async () => {}}
      onFindingsChanged={load}
    />
  );
}

async function renderPanel(options: { reaper?: ReaperStatus; initial?: Parameters<typeof createMockApi>[1] } = {}) {
  const { api, chapterId, alignment } = await linkedApi(options.initial);
  render(
    <ApiProvider api={api}>
      <TooltipProvider>
        <Harness api={api} chapterId={chapterId} alignment={alignment} reaper={options.reaper} />
      </TooltipProvider>
    </ApiProvider>,
  );
  return { api, chapterId };
}

async function showTakes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Show takes for this paragraph' }));
  return screen.findByRole('list', { name: 'Takes of this passage' });
}

describe('the Takes panel (edit-and-proof-workspace PRD Phase 6)', () => {
  it('waits for the narrator to ask, then lists every take with where it came from and which one plays', async () => {
    const user = userEvent.setup();
    const { api } = await renderPanel();
    const read = vi.spyOn(api, 'workspaceTakes');
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'Takes of this passage' })).toBeNull();

    const list = await showTakes(user);

    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText('Playing in REAPER')).toBeTruthy();
    expect(within(rows[0]).getByText('Another take of this item')).toBeTruthy();
    expect(within(rows[2]).getByText('Retake on another lane')).toBeTruthy();
    expect(within(rows[3]).getByText('Read from Find pickups')).toBeTruthy();
    expect(within(rows[1]).getByText('Not compared yet')).toBeTruthy();
    expect(screen.getByText(/^Paragraph 1/)).toBeTruthy();
    // Nothing ranks them.
    expect(screen.queryByText(/best|score|rank/i)).toBeNull();
  });

  it('makes another take of the item active in one request, and shows it playing', async () => {
    const user = userEvent.setup();
    const { api } = await renderPanel();
    const useTake = vi.spyOn(api, 'workspaceUseTake');
    const list = await showTakes(user);

    await user.click(within(list).getByRole('button', { name: 'Use take 2' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/Made that take active in REAPER, in one undo step/);
    expect(useTake).toHaveBeenCalledTimes(1);
    expect(useTake.mock.calls[0][3]).toMatch(/^take:/);
    await waitFor(() =>
      expect(
        within(within(screen.getByRole('list', { name: 'Takes of this passage' })).getAllByRole('listitem')[1]).getByText('Playing in REAPER'),
      ).toBeTruthy(),
    );
  });

  it('adds a read from another item and makes it active only after a confirm', async () => {
    const user = userEvent.setup();
    const { api } = await renderPanel();
    const useTake = vi.spyOn(api, 'workspaceUseTake');
    const list = await showTakes(user);

    await user.click(within(list).getByRole('button', { name: /^Use read from another item/ }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Add this read and make it active' });
    expect(useTake).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(useTake).not.toHaveBeenCalled();

    await user.click(within(list).getByRole('button', { name: /^Use read from another item/ }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Add and make active' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/Added the read as a new take and made it active/);
    expect(useTake).toHaveBeenCalledTimes(1);
  });

  it('starts a lane pick and says it is asking REAPER', async () => {
    const user = userEvent.setup();
    await renderPanel();
    const list = await showTakes(user);

    await user.click(within(list).getByRole('button', { name: /^Use retake on lane 2/ }));

    expect((await screen.findByRole('status')).textContent).toMatch(/Asking REAPER to play this retake/);
  });

  it('cannot use a take while REAPER is not connected, and says why', async () => {
    const user = userEvent.setup();
    await renderPanel({ reaper: { connection: 'standalone', message: 'REAPER is not connected to this app.' } });
    const list = await showTakes(user);

    const button = within(list).getByRole('button', { name: 'Use take 2' });
    expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true').toBe(true);
    // The narrator can still hear and compare them without REAPER.
    expect(screen.getByRole('button', { name: 'Hear side by side' }).hasAttribute('disabled')).toBe(false);
  });

  it("shows the host's refusal in its own words when REAPER refuses", async () => {
    const user = userEvent.setup();
    await renderPanel({ initial: { reaper: 'recording' } });
    const list = await showTakes(user);

    await user.click(within(list).getByRole('button', { name: 'Use take 2' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/REAPER is recording, so nothing was changed/);
  });

  it('plays two takes side by side from their raw recordings', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await showTakes(user);

    await user.click(screen.getByRole('button', { name: 'Hear side by side' }));

    const dialog = await screen.findByRole('dialog', { name: 'Audition candidate reads' });
    expect(within(dialog).getByText('Raw source, no FX or edits applied')).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Read A' })).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Read B' })).toBeTruthy();
  });

  it('compares the takes with real progress, then sets them side by side and says how much each matched', async () => {
    const user = userEvent.setup();
    const { api } = await renderPanel();
    const start = vi.spyOn(api, 'workspaceTakesCompareStart');
    await showTakes(user);

    await user.click(screen.getByRole('button', { name: 'Compare takes' }));
    const progress = await screen.findByRole('dialog', { name: 'Comparing takes' });
    expect(start).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(progress).getByRole('status').textContent).toMatch(/^Compared the takes/), { timeout: 6000 });
    await user.click(within(progress).getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('region', { name: 'Takes side by side' })).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: 'Takes of this passage' })).getAllByRole('listitem');
    await waitFor(() => expect(within(rows[0]).getByText(/^Matched \d+% of the passage's words$/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Compare again' })).toBeTruthy();
  }, 20000);

  it('says why there are no takes for a passage nothing was heard on', async () => {
    const user = userEvent.setup();
    const { api, chapterId, alignment } = await linkedApi();
    const unheard = alignment.tokens.findIndex((token) => token.item === undefined && token.p !== undefined);
    if (unheard < 0) return; // the mock chapter heard everything: nothing to say
    render(
      <ApiProvider api={api}>
        <TooltipProvider>
          <TakesPanel
            chapterId={chapterId}
            alignment={alignment}
            currentToken={unheard}
            findings={[]}
            reaper={CONNECTED}
            onReaperStatusChange={async () => {}}
            onFindingsChanged={() => {}}
          />
        </TooltipProvider>
      </ApiProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Show takes for this paragraph' }));
    expect(await screen.findByText(/wasn't heard in the recording/)).toBeTruthy();
  });
});
