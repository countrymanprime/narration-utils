// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PRODUCTION_SCENARIOS } from '../../api/productionMock';
import { useCallback, useState } from 'react';
import { ChapterBoard } from './ChapterBoard';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { ProductionChapter, ProductionOverview } from '../../api/contracts/production';
import type { NarrationApi } from '../../types';
import type { Notify } from '../primitives/Toast';

afterEach(cleanup);

type Overrides = Parameters<typeof createMockApi>[0];
type Initial = Parameters<typeof createMockApi>[1];

// The board as the Production home holds it: the overview it was given, read again whenever the board says something changed.
function Board({
  api,
  initial,
  onChanged,
  ...props
}: {
  api: NarrationApi;
  initial: ProductionOverview;
  onChanged: () => void;
  notify: Notify;
  goToScript: (chapter: string, paragraph?: number) => void;
  goToProofChapter: (chapterId: string) => void;
  refreshKey?: string;
}) {
  const [overview, setOverview] = useState(initial);
  const changed = useCallback(() => {
    onChanged();
    void api.productionOverview().then(setOverview);
  }, [api, onChanged]);
  return (
    <ChapterBoard
      overview={overview}
      notify={props.notify}
      goToScript={props.goToScript}
      goToProofChapter={props.goToProofChapter}
      refreshKey={props.refreshKey}
      onChanged={changed}
    />
  );
}

/** Renders the board over the mock host; `prepare` may replace a binding on the api before the first overview is read. */
async function renderBoard(overrides: Overrides = {}, initial: Initial = {}, prepare: (api: NarrationApi) => void = () => {}) {
  const api = createMockApi(overrides, initial);
  prepare(api);
  const notify = vi.fn();
  const goToScript = vi.fn();
  const goToProofChapter = vi.fn();
  const onChanged = vi.fn();
  const overview = await api.productionOverview();
  const props = { api, initial: overview, notify, goToScript, goToProofChapter, onChanged };
  const view = render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <Board {...props} />
      </ApiProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByRole('grid', { name: 'Chapter pipeline' }) ?? screen.queryByText('No narratable chapters yet.')).toBeTruthy());
  const rerender = (refreshKey: string) =>
    view.rerender(
      <MemoryRouter>
        <ApiProvider api={api}>
          <Board {...props} refreshKey={refreshKey} />
        </ApiProvider>
      </MemoryRouter>,
    );
  return { api, notify, goToScript, goToProofChapter, onChanged, rerender };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The row a chapter (by its title) or a credits row (by its label) heads, or null when it is not on the board. */
const boardRow = (name: string) =>
  within(screen.getByRole('grid', { name: 'Chapter pipeline', hidden: true }))
    .queryByRole('rowheader', { name: new RegExp(`^${escape(name)}( —|$)`), hidden: true })
    ?.closest('tr') ?? null;

/** One board cell, by its row and its column's name. */
const cell = (name: string, column: string) => {
  const grid = screen.getByRole('grid', { name: 'Chapter pipeline', hidden: true });
  const columns = within(grid)
    .getAllByRole('columnheader', { hidden: true })
    .map((header) => header.textContent);
  const row = boardRow(name);
  if (!row) throw new Error(`no row ${name} on the board`);
  // The first column header is the row headers' own.
  return within(row).getAllByRole('gridcell', { hidden: true })[columns.indexOf(column) - 1];
};

/** Clicks a chapter's Recorded cell once the track links are read, and returns its track slide-over. */
const openTrack = async (title: string) => {
  await waitFor(() => {
    fireEvent.click(cell(title, 'Recorded'));
    expect(screen.getByRole('dialog', { name: new RegExp(`^Track: ${title}( — |$)`) })).toBeTruthy();
  });
  return screen.getByRole('dialog', { name: new RegExp(`^Track: ${title}( — |$)`) });
};

/** The state a track slide-over's header names ("Suggested", "Linked", "Not linked"). */
const trackState = (dialog: HTMLElement) => dialog.querySelector('.uppercase.tracking-\\[var\\(--tracking-label\\)\\]')?.textContent;

const withChapters = (api: NarrationApi, change: (chapter: ProductionChapter) => ProductionChapter) => {
  const read = api.productionOverview;
  api.productionOverview = async () => {
    const overview = await read();
    return { ...overview, chapters: overview.chapters.map(change) };
  };
};

describe('ChapterBoard', () => {
  it('lays the narration chapters out as rows under the stage columns', async () => {
    await renderBoard();
    await waitFor(() => expect(screen.getByRole('rowheader', { name: 'Opening credits' })).toBeTruthy());
    const grid = screen.getByRole('grid', { name: 'Chapter pipeline', hidden: true });
    expect(
      within(grid)
        .getAllByRole('columnheader', { hidden: true })
        .map((header) => header.textContent),
    ).toEqual(['Chapter', 'Recorded', 'Prep', 'Record', 'Edit', 'Proof', 'Pickups', 'Master', 'QC']);
    expect(within(grid).getAllByRole('rowheader', { hidden: true })).toHaveLength(14);
    expect(within(grid).getAllByRole('rowheader', { hidden: true })[1].textContent).toBe('Chapter 1 — Down the Rabbit-Hole');
    expect(cell('Chapter 1', 'Proof').textContent).toBe('✓');
    expect(cell('Chapter 11', 'Record').textContent).toBe('—');
    expect(cell('Chapter 11', 'Edit').textContent).toBe('—');
    for (const column of ['Pickups', 'Master', 'QC']) expect(cell('Chapter 1', column).textContent).toBe('—');
  });

  it('says so when there are no narratable chapters yet', async () => {
    await renderBoard({}, {}, (api) => {
      const read = api.productionOverview;
      api.productionOverview = async () => ({ ...(await read()), chapters: [] });
    });
    expect(await screen.findByText('No narratable chapters yet.')).toBeTruthy();
  });

  it("opens the chapter's track slide-over from its Recorded cell", async () => {
    await renderBoard();
    const dialog = await openTrack('Chapter 1');
    expect(within(dialog).getByText('Found through')).toBeTruthy();
  });

  it("opens the chapter's stage suggestion from its current stage cell, with the status select and the ways into its checks", async () => {
    await renderBoard();
    fireEvent.click(cell('Chapter 4', 'Record'));
    const view = await screen.findByRole('dialog', { name: /^Stage suggestion: Chapter 4\b/ });
    expect(((await within(view).findByLabelText('Chapter 4 status')) as HTMLSelectElement).value).toBe('recording');
    expect(within(view).getByText(/^Recording check: /)).toBeTruthy();
    expect(within(view).getByRole('button', { name: 'Recording check' })).toBeTruthy();
    expect(within(view).getByRole('button', { name: 'Editing check' })).toBeTruthy();
  });

  it("opens the stage suggestion from a not-started chapter's Record cell", async () => {
    await renderBoard();
    fireEvent.click(cell('Chapter 11', 'Record'));
    expect(await screen.findByRole('dialog', { name: /^Stage suggestion: Chapter 11\b/ })).toBeTruthy();
  });

  it('opens the recording check from a Record cell that is done', async () => {
    await renderBoard();
    await waitFor(() => {
      fireEvent.click(cell('Chapter 1', 'Record'));
      expect(screen.getByRole('dialog', { name: /^Recording check: Chapter 1\b/ })).toBeTruthy();
    });
  });

  it('opens the editing check from an Edit cell that is done', async () => {
    await renderBoard();
    await waitFor(() => {
      fireEvent.click(cell('Chapter 1', 'Edit'));
      expect(screen.getByRole('dialog', { name: /^Editing check: Chapter 1\b/ })).toBeTruthy();
    });
  });

  it("opens the chapter's Proof view from a Proof cell that is done, and the chapter on Script from Prep", async () => {
    const { goToProofChapter, goToScript } = await renderBoard();
    fireEvent.click(cell('Chapter 1', 'Proof'));
    expect(goToProofChapter).toHaveBeenCalledWith('chapter-1');
    fireEvent.click(cell('Chapter 2', 'Prep'));
    expect(goToScript).toHaveBeenCalledWith('chapter-2');
  });

  it('sets a status from the stage slide-over and tells the page the overview changed', async () => {
    const { api, onChanged } = await renderBoard();
    const manuscriptSetChapterStatus = vi.spyOn(api, 'manuscriptSetChapterStatus');
    fireEvent.click(cell('Chapter 4', 'Record'));
    const view = await screen.findByRole('dialog', { name: /^Stage suggestion: Chapter 4\b/ });
    const select = (await within(view).findByLabelText('Chapter 4 status')) as HTMLSelectElement;
    onChanged.mockClear();
    fireEvent.change(select, { target: { value: 'editing' } });
    await waitFor(() => expect(manuscriptSetChapterStatus).toHaveBeenCalledWith('chapter-4', 'editing'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(select.value).toBe('editing'));
  });
});

describe('recorded length on the board (actual-recorded-column.prd.md)', () => {
  it('names why a chapter has no recorded length', async () => {
    await renderBoard();
    // The default demo has no confirmed chapter-track links.
    expect(cell('Chapter 1', 'Recorded').textContent).toBe('No track');
    expect(cell('Chapter 7', 'Recorded').textContent).toBe('No track');
  });

  it("shows the linked track's measured length, and leaves it unchanged when the status changes (Phase 1 and 3)", async () => {
    await renderBoard({}, {}, (api) =>
      withChapters(api, (chapter) =>
        chapter.id === 'chapter-4'
          ? { ...chapter, recordedSeconds: 2520.5, recordedUnavailable: undefined }
          : chapter.id === 'chapter-2'
            ? { ...chapter, recordedSeconds: 45, recordedUnavailable: undefined }
            : chapter.id === 'chapter-3'
              ? { ...chapter, recordedUnavailable: 'multiple_tracks' }
              : chapter,
      ),
    );
    expect(cell('Chapter 4', 'Recorded').textContent).toBe('42:01');
    expect(cell('Chapter 2', 'Recorded').textContent).toBe('0:45');
    expect(cell('Chapter 3', 'Recorded').textContent).toBe('2+ tracks');
    fireEvent.click(cell('Chapter 4', 'Record'));
    const view = await screen.findByRole('dialog', { name: /^Stage suggestion: Chapter 4\b/ });
    const select = (await within(view).findByLabelText('Chapter 4 status')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'editing' } });
    await waitFor(() => expect(select.value).toBe('editing'));
    await waitFor(() => expect(cell('Chapter 4', 'Edit').textContent).not.toBe('—'));
    expect(cell('Chapter 4', 'Recorded').textContent).toBe('42:01');
  });

  it("shows the measured length in the chapter's track slide-over", async () => {
    await renderBoard({}, {}, (api) =>
      withChapters(api, (chapter) => (chapter.id === 'chapter-1' ? { ...chapter, recordedSeconds: 2520.5, recordedUnavailable: undefined } : chapter)),
    );
    const dialog = await openTrack('Chapter 1');
    expect(within(dialog).getByText('Recorded length').nextElementSibling?.textContent).toBe('42m');
  });
});

describe('credits rows on the board (credits-in-chapter-table.prd.md Phase 2)', () => {
  const rowNames = () =>
    within(screen.getByRole('grid', { name: 'Chapter pipeline', hidden: true }))
      .getAllByRole('rowheader', { hidden: true })
      .map((header) => header.textContent);
  const openCredits = async (label: 'Opening credits' | 'Closing credits', column = 'Record') => {
    fireEvent.click(cell(label, column));
    return screen.findByRole('dialog', { name: label });
  };

  it('places Opening credits first and Closing credits last, around the twelve chapters (CT1)', async () => {
    await renderBoard();
    await waitFor(() => expect(rowNames()[0]).toBe('Opening credits'));
    const names = rowNames();
    expect(names[names.length - 1]).toBe('Closing credits');
    expect(names).toHaveLength(14);
  });

  it('leaves the credits rows out when the credit template library cannot be read, without a toast', async () => {
    const { notify } = await renderBoard({
      creditsTemplates: async () => {
        throw new Error('boom');
      },
    });
    await waitFor(() => expect(rowNames()).toHaveLength(12));
    expect(rowNames()).not.toContain('Opening credits');
    expect(notify).not.toHaveBeenCalled();
  });

  it('shows the template, its words and length, and a link to it on Script in its slide-over (CT4)', async () => {
    const segment = 'word '.repeat(155).trim();
    await renderBoard({
      creditsTemplates: async () => [
        { id: 'o', kind: 'opening', name: 'Opening', body: segment },
        { id: 'c', kind: 'closing', name: 'Closing', body: segment },
      ],
      creditsPreview: async (body: string) => ({ text: body, words: body.split(/\s+/).filter(Boolean).length, unresolved: [] }),
    });
    await waitFor(() => expect(rowNames()[0]).toBe('Opening credits'));
    // No track is linked yet (Phase 3): the same "No track" a manuscript chapter's own Recorded cell shows.
    expect(cell('Opening credits', 'Recorded').textContent).toBe('No track');
    const dialog = await openCredits('Opening credits');
    // A 155-word segment at 155 wpm reads 60s; the room-tone allowance defaults to 0.
    expect(within(dialog).getByText(/155 words · about 1m/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Open in Script' }).getAttribute('href')).toBe('/script#credits-opening');
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('shows its own measured Recorded length once a track is linked to the credits id (Phase 3)', async () => {
    const { api, rerender } = await renderBoard();
    await waitFor(() => expect(rowNames()[0]).toBe('Opening credits'));
    await api.chapterTrackMapConfirm('{0E4D1D7F-D039-674D-87E6-719376DE95EC}', 'credits-opening');
    rerender('after-link');
    await waitFor(() => expect(cell('Opening credits', 'Recorded').textContent).not.toBe('No track'));
    expect(cell('Closing credits', 'Recorded').textContent).toBe('No track');
  });

  it("enables the credits row's Check button, opening the same recording-check dialog a manuscript chapter uses (Phase 3, CT4)", async () => {
    await renderBoard();
    await waitFor(() => expect(rowNames()[0]).toBe('Opening credits'));
    const panel = await openCredits('Opening credits');
    fireEvent.click(within(panel).getByRole('button', { name: 'Recording check' }));
    const check = await screen.findByRole('dialog', { name: 'Recording check: Opening credits' });
    expect(within(check).getByText(/Not checked yet/)).toBeTruthy();
    expect(within(check).getByRole('button', { name: 'Check recording' })).toBeTruthy();
  });

  it("a manuscript chapter's own recording check is unchanged by the credits Check button existing (Phase 3, regression)", async () => {
    await renderBoard();
    fireEvent.click(cell('Chapter 1', 'Record'));
    const dialog = await screen.findByRole('dialog', { name: /^Recording check: Chapter 1/ });
    // Chapter 1's default mock result already has a report: unlike a credits row's dialog, it keeps its "Open in Proof" link.
    expect(within(dialog).getByRole('button', { name: 'Open in Proof' })).toBeTruthy();
  });

  it('warns when a credits template has an unresolved token, without hiding or blocking the row (C6)', async () => {
    // The default demo seeds no credit values, so every [Token] in the built-in templates is unresolved.
    await renderBoard();
    await waitFor(() => expect(rowNames()[0]).toBe('Opening credits'));
    const dialog = await openCredits('Opening credits');
    expect(within(dialog).getByText('ACX minimum (opening)')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toMatch(/not filled in/);
    expect(within(dialog).getByLabelText('Opening credits status')).toBeTruthy();
  });

  it('shows no warning once every token is filled', async () => {
    await renderBoard({}, { creditValues: { title: 'A Book', author: 'A. Author', narrator: 'A. Narrator' } });
    await waitFor(() => expect(rowNames()[0]).toBe('Opening credits'));
    const dialog = await openCredits('Opening credits');
    expect(within(dialog).queryByText(/not filled in/)).toBeNull();
  });

  it('shows "Not set up" with a link to Settings > Credits for a missing template (CT5)', async () => {
    await renderBoard({}, { creditsMissingClosing: true });
    await waitFor(() => expect(rowNames()).toContain('Closing credits'));
    expect(cell('Closing credits', 'Recorded').textContent).toBe('Not set up');
    const dialog = await openCredits('Closing credits', 'Recorded');
    expect(within(dialog).getByText(/Not set up/)).toBeTruthy();
    expect(
      within(dialog)
        .getByRole('link', { name: /Add a closing template in Settings/ })
        .getAttribute('href'),
    ).toBe('/settings#credits');
    expect(within(dialog).queryByRole('link', { name: 'Open in Script' })).toBeNull();
  });

  it('changes a row status through setCreditsStatus, never manuscriptSetChapterStatus or the stage engine (CT1, CT2, CT3)', async () => {
    const setCreditsStatus = vi.fn(async (kind: string, status: string) => ({ [kind]: status }));
    const manuscriptSetChapterStatus = vi.fn();
    await renderBoard({ setCreditsStatus, manuscriptSetChapterStatus });
    await waitFor(() => expect(rowNames()[0]).toBe('Opening credits'));
    expect(cell('Opening credits', 'Proof').textContent).toBe('—');
    const dialog = await openCredits('Opening credits');
    fireEvent.change(within(dialog).getByLabelText('Opening credits status'), { target: { value: 'finalized' } });
    await waitFor(() => expect((within(dialog).getByLabelText('Opening credits status') as HTMLSelectElement).value).toBe('finalized'));
    expect(setCreditsStatus).toHaveBeenCalledWith('opening', 'finalized');
    expect(manuscriptSetChapterStatus).not.toHaveBeenCalled();
    expect(cell('Opening credits', 'Proof').textContent).toBe('✓');
  });

  it('never sends a credits id to manuscriptChapters, stages or coverage', async () => {
    const { api } = await renderBoard();
    const chapters = await api.manuscriptChapters();
    expect(chapters.some((chapter) => chapter.id.startsWith('credits-'))).toBe(false);
  });
});

// chapter-track-link-control.prd.md Phase 2: the track slide-over the Recorded cell opens, driven against the same ChapterTrackLinks mock
// (chapterTrackMatchMock.ts). The default demo project ("ready") names its tracks "Chapter 1" and "Chapter 2" (mockFixtures.ts's
// WIRE_TRACKS_PROJECT), which match those two chapters' titles exactly, so they read "suggested"; every other chapter has no name match
// and reads "not linked" (TL1-TL4).
describe('chapter-track link control on the board', () => {
  const closeTrack = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

  it("shows each chapter's suggested or not-linked state (TL1-TL4)", async () => {
    await renderBoard();
    const first = await openTrack('Chapter 1');
    expect(trackState(first)).toBe('Suggested');
    closeTrack(first);
    expect(trackState(await openTrack('Chapter 3'))).toBe('Not linked');
  });

  it('shows what the suggestion was found through, and confirms it through Another track… (TL5)', async () => {
    const { notify } = await renderBoard();
    const dialog = await openTrack('Chapter 1');
    expect(within(dialog).getByText('Found through')).toBeTruthy();
    expect(within(dialog).getByText('Track name')).toBeTruthy();
    // A suggestion is shown pre-filled (MappingConfirm's read view): Another track… reveals the picker, already on the suggested track.
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Another track…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Track linked.'));
    await waitFor(() => expect(trackState(dialog)).toBe('Linked'));
    expect(within(dialog).getByText(/, by you$/)).toBeTruthy();
  });

  it('offers every unclaimed track to a chapter with no suggestion, and reflects the link after Confirm (TL3)', async () => {
    const { notify } = await renderBoard();
    const dialog = await openTrack('Chapter 3');
    expect(within(dialog).queryByText('Possible tracks')).toBeNull();
    const select = await within(dialog).findByLabelText('Track for Chapter 3');
    fireEvent.change(select, { target: { value: '{DA2D209F-D10F-5E46-93E7-098D96499ED0}' } }); // "Chapter 2" track
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Track linked.'));
    await waitFor(() => expect(trackState(dialog)).toBe('Linked'));
  });

  it("tells the narrator when linking a track displaces another chapter's confirmed link, and lets it be unlinked (TL5, TL6)", async () => {
    const { notify } = await renderBoard();
    const first = await openTrack('Chapter 1');
    fireEvent.click(await within(first).findByRole('button', { name: 'Another track…' }));
    fireEvent.click(within(first).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(trackState(first)).toBe('Linked'));
    closeTrack(first);

    // Chapter 3 has no suggestion of its own; link it onto the same "Chapter 1" track Chapter 1 just confirmed.
    const second = await openTrack('Chapter 3');
    fireEvent.change(await within(second).findByLabelText('Track for Chapter 3'), { target: { value: '{0E4D1D7F-D039-674D-87E6-719376DE95EC}' } });
    fireEvent.click(within(second).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Linked. This track was linked to Chapter 1, which is now unlinked.'));
    await waitFor(() => expect(trackState(second)).toBe('Linked'));
    closeTrack(second);
    // Chapter 1 has no other track to suggest while this one is claimed elsewhere.
    const again = await openTrack('Chapter 1');
    expect(trackState(again)).toBe('Not linked');
    closeTrack(again);

    // Unlink Chapter 3: freeing the track lets the matcher suggest it back to Chapter 1 by name, same as at the start.
    const third = await openTrack('Chapter 3');
    fireEvent.click(await within(third).findByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Track unlinked.'));
    await waitFor(() => expect(trackState(third)).toBe('Not linked'));
    closeTrack(third);
    expect(trackState(await openTrack('Chapter 1'))).toBe('Suggested');
  });

  it('shows the project message when no REAPER project was found, and suggests no track (TL7)', async () => {
    await renderBoard({}, { tracksCandidates: [] });
    expect(await screen.findByText('No REAPER project (.rpp) file was found in this project folder.')).toBeTruthy();
    const dialog = await openTrack('Chapter 1');
    expect(trackState(dialog)).toBe('Not linked');
    expect(within(dialog).queryByText('Found through')).toBeNull();
  });

  it('points to the Tracks page to choose a project when more than one REAPER project file is found (TL7)', async () => {
    await renderBoard({}, { tracksCandidates: ['C:/proj/one.rpp', 'C:/proj/two.rpp'] });
    expect(await screen.findByText(/Choose which REAPER project file to use in the audio engine panel\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose it on Tracks' }).getAttribute('href')).toBe('/tracks');
  });
});

describe('chapter-sync toast on the board (daw-chapter-track-auto-sync.prd.md Phase 3, S12)', () => {
  it('shows one toast with Undo for a sync batch, and Undo calls chapterSyncUndo for each link', async () => {
    const { api, notify } = await renderBoard({}, { chapterSync: 'linked' });
    await waitFor(() => expect(notify).toHaveBeenCalled());
    const [text, tone, action] = notify.mock.calls[0];
    expect(text).toMatch(/^Linked (track “.+” to Chapter \d+|\d+ tracks to chapters)\.$/);
    expect(tone).toBe('info');
    expect(action).toEqual({ label: 'Undo', onAction: expect.any(Function) });
    const undoSpy = vi.spyOn(api, 'chapterSyncUndo');
    action.onAction();
    await waitFor(() => expect(undoSpy).toHaveBeenCalled());
  });

  it('never toasts twice for the same batch', async () => {
    const { notify, rerender } = await renderBoard({}, { chapterSync: 'linked' });
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    rerender('again');
    await screen.findByRole('grid', { name: 'Chapter pipeline' });
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('remove from recording (chapter-track-link-control.prd.md Phase 3)', () => {
  const openRemove = async (title: string) => {
    const panel = await openTrack(title);
    expect(within(panel).getByText(/^Imported by mistake\?/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove from recording…' }));
    return screen.findByRole('alertdialog', { name: `Remove ${title} from recording?` });
  };

  it('removes a chapter from recording, drops it from the board, and lists it under Removed from recording with Restore', async () => {
    const { notify } = await renderBoard();
    const confirm = await openRemove('Chapter 3');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove from recording' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Chapter 3 removed from recording.'));
    // The slide-over closes with the row it was about, and the row itself leaves the board.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Track: Chapter 3( — |$)/ })).toBeNull());
    await waitFor(() => expect(boardRow('Chapter 3')).toBeNull());
    expect(await screen.findByText('Removed from recording (1)')).toBeTruthy();
    expect(screen.getByText(/removed today as not a chapter/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Chapter 3 restored.'));
    await waitFor(() => expect(boardRow('Chapter 3')).not.toBeNull());
    expect(screen.queryByText(/Removed from recording/)).toBeNull();
  });

  it('reclassifies as front matter when that option is chosen', async () => {
    await renderBoard();
    const confirm = await openRemove('Chapter 3');
    fireEvent.click(within(confirm).getByRole('radio', { name: 'Front matter' }));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove from recording' }));
    expect(await screen.findByText(/removed today as front matter/)).toBeTruthy();
  });

  it('cancels without changing anything', async () => {
    await renderBoard();
    const confirm = await openRemove('Chapter 3');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog', { name: 'Remove Chapter 3 from recording?' })).toBeNull();
    // The track panel itself is untouched: still open on the same chapter, nothing removed.
    expect(await screen.findByRole('dialog', { name: /^Track: Chapter 3( — |$)/ })).toBeTruthy();
    expect(boardRow('Chapter 3')).not.toBeNull();
  });

  it('shows the reason and a failure toast when the host refuses (the last narration chapter)', async () => {
    const manuscriptSetChapterKind = vi.fn().mockRejectedValue(new Error('the last narration chapter cannot be removed from recording'));
    const { notify } = await renderBoard({ manuscriptSetChapterKind });
    const confirm = await openRemove('Chapter 3');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove from recording' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Error: the last narration chapter cannot be removed from recording', 'error'));
    // The confirm stays open so the narrator sees the failure and can cancel or retry.
    expect(screen.getByRole('alertdialog', { name: 'Remove Chapter 3 from recording?' })).toBeTruthy();
  });

  // Mock 01 (ADR 0645): the chapter the timer runs on is the board's current row, in bold, and a length is a figure, not a badge.
  it('draws the chapter a timer runs on in bold, and its length as a figure', async () => {
    await renderBoard({}, { production: PRODUCTION_SCENARIOS['on-pace'] });
    await waitFor(() => expect(cell('Chapter 1', 'Recorded').textContent).toBe('11:48'));
    const header = (name: string) => screen.getByRole('rowheader', { name: new RegExp(`^${name} —`), hidden: true });
    expect(header('Chapter 6').className).toContain('font-semibold');
    expect(header('Chapter 5').className).toContain('font-normal');
    expect(cell('Chapter 1', 'Recorded').querySelector('span')?.className).toContain('IBM_Plex_Mono');
  });
});
