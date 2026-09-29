// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_FINDINGS } from '../../api/mockFixtures';
import { TooltipProvider } from '../primitives/Tooltip';
import type { Finding, NarrationApi } from '../../types';
import { ProofPage } from './ProofPage';
import { loadLastChapter, saveLastChapter } from './lastChapterStorage';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

type Initial = Parameters<typeof createMockApi>[1];

function renderPage({
  projectFolder = '/p',
  overrides = {},
  initial = {},
  hasManuscript = true,
  goToWorkspace,
}: {
  projectFolder?: string;
  overrides?: Partial<NarrationApi>;
  initial?: Initial;
  hasManuscript?: boolean;
  goToWorkspace?: (chapterId: string, findingId: string) => void;
} = {}) {
  const api = createMockApi(overrides, initial);
  const goToManuscript = vi.fn();
  const goToStoryBible = vi.fn();
  const goToMaster = vi.fn();
  const notify = vi.fn();
  render(
    <ApiProvider api={api}>
      <TooltipProvider>
        <ProofPage
          projectFolder={projectFolder}
          notify={notify}
          hasManuscript={hasManuscript}
          goToManuscript={goToManuscript}
          goToStoryBible={goToStoryBible}
          goToWorkspace={goToWorkspace}
          goToMaster={goToMaster}
          openChapter={vi.fn()}
        />
      </TooltipProvider>
    </ApiProvider>,
  );
  return { api, goToManuscript, goToStoryBible, goToMaster, notify };
}

const rows = async () => {
  const table = await screen.findByRole('table', { name: 'Notes' });
  await waitFor(() => expect(within(table).queryAllByRole('row').length).toBeGreaterThan(1));
  return within(table).getAllByRole('row').slice(1);
};

const openFinding = async (user: ReturnType<typeof userEvent.setup>, text: RegExp) => {
  const row = (await rows()).find((candidate) => text.test(candidate.textContent ?? ''));
  if (!row) throw new Error(`no row matches ${text}`);
  await user.click(row);
};

// Mock 04 draws no filter row (mock-fidelity-primitives-and-components.prd.md Phase 12): the filters sit behind this button.
const openFilters = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: /^Filters/ }));
  await screen.findByRole('group', { name: 'Filter findings' });
};

describe('ProofPage', () => {
  it('lists the latest run with the counts by status, and asks the narrator to pick a finding', async () => {
    renderPage();
    expect(await rows()).toHaveLength(4);
    // Mock 04's notes header (D85 #7): "Notes · N" and a chip per resolution that has notes.
    expect(await screen.findByRole('heading', { name: 'Notes · 4' })).toBeTruthy();
    expect(screen.getByText('3 to review')).toBeTruthy();
    expect(screen.getByText('1 waived')).toBeTruthy();
    // PF4: the Sources line names where the notes come from.
    expect(screen.getByText('local AI compare · Story Bible')).toBeTruthy();
    expect(screen.getByText(/Select a note to see its evidence/)).toBeTruthy();
    const first = (await rows())[0];
    expect(first.textContent).toContain('“a White Rabbit with pink eyes” read as “a white rabbit with pale eyes”');
    expect(first.textContent).toContain('90%');
    // PF2: the Type column shows the evidence's own kind, not the broader category, when the analyzer reports one.
    expect(first.textContent).toContain('Misread');
    const entityRow = (await rows()).find((row) => /White Rabbit/.test(row.textContent ?? '') && !/pink eyes/.test(row.textContent ?? ''));
    expect(entityRow?.textContent).toContain('Story Bible entry');
  });

  it('says there is nothing to review yet, with no filters, when the project has no findings', async () => {
    renderPage({ initial: { findings: [] } });
    expect(await screen.findByRole('heading', { name: 'No notes yet' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Filter findings' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('sends each filter to the host and shows what it answers', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    const list = vi.spyOn(api, 'findingsList');
    await rows();
    await openFilters(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Check' }), 'story-bible');
    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ analyzer: 'story-bible', sort: 'chapter' })));
    await waitFor(async () => expect(await rows()).toHaveLength(1));
    await user.click(screen.getByRole('switch', { name: 'Include findings the latest run did not repeat' }));
    await waitFor(async () => expect(await rows()).toHaveLength(2));
    expect((await rows())[1].textContent).toContain('not in the latest run');
  });

  describe('the waveform card and the chapter filter (ADR 0750, D100)', () => {
    const picker = () => screen.findByRole('combobox', { name: 'Chapter to open' });

    it('opens on the first narration chapter when the narrator has looked at none, with every note listed', async () => {
      renderPage();
      expect(((await picker()) as HTMLSelectElement).value).toBe('chapter-1');
      expect(screen.queryByRole('button', { name: 'Show all chapters' })).toBeNull();
      expect((await rows()).length).toBeGreaterThan(2);
    });

    it('opens on the last chapter the narrator looked at in this project', async () => {
      saveLastChapter('/p', 'chapter-2');
      renderPage();
      await waitFor(async () => expect(((await picker()) as HTMLSelectElement).value).toBe('chapter-2'));
    });

    it("ignores another project's chapter, and a remembered chapter that no longer exists", async () => {
      saveLastChapter('/other', 'chapter-2');
      saveLastChapter('/p', 'gone');
      renderPage();
      expect(((await picker()) as HTMLSelectElement).value).toBe('chapter-1');
    });

    it('filters the notes table to the picked chapter, remembers it, and offers the way back', async () => {
      const user = userEvent.setup();
      const { api } = renderPage();
      const list = vi.spyOn(api, 'findingsList');
      const all = (await rows()).length;
      await user.selectOptions(await picker(), 'chapter-2');
      await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ chapterId: 'chapter-2' })));
      await waitFor(async () => expect((await rows()).length).toBeLessThan(all));
      for (const row of await rows()) expect(row.textContent).toContain('Chapter 2');
      expect(loadLastChapter('/p')).toBe('chapter-2');
      await user.click(screen.getByRole('button', { name: 'Show all chapters' }));
      await waitFor(async () => expect((await rows()).length).toBe(all));
      expect(screen.queryByRole('button', { name: 'Show all chapters' })).toBeNull();
      // Showing every chapter again leaves the card on the chapter it was on.
      expect(((await picker()) as HTMLSelectElement).value).toBe('chapter-2');
    });

    it('moves the card to the chapter the Filters popover names', async () => {
      const user = userEvent.setup();
      renderPage();
      await rows();
      await openFilters(user);
      await user.selectOptions(screen.getByRole('combobox', { name: 'Chapter' }), 'chapter-2');
      await waitFor(async () => expect(((await picker()) as HTMLSelectElement).value).toBe('chapter-2'));
    });
  });

  it('hides low-confidence and unscored findings with the confidence switch', async () => {
    const user = userEvent.setup();
    renderPage();
    await rows();
    await openFilters(user);
    await user.click(screen.getByRole('switch', { name: 'Only findings scored 50% or more' }));
    await waitFor(async () => expect(await rows()).toHaveLength(1));
  });

  it('offers to clear filters that match nothing, and clearing brings the list back', async () => {
    const user = userEvent.setup();
    renderPage();
    await rows();
    await openFilters(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'deferred');
    expect(await screen.findByText('No findings match these filters.')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Notes' });
    await user.click(within(table).getByRole('button', { name: 'Clear filters' }));
    await waitFor(async () => expect(await rows()).toHaveLength(4));
    // Clicking "Clear filters" in the table is an outside click, so it closes the filters popover; reopen it to check.
    await openFilters(user);
    expect((screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement).value).toBe('');
  });

  it('shows a finding with its evidence and confidence reason, and its REAPER controls', async () => {
    const user = userEvent.setup();
    renderPage();
    await openFinding(user, /pink eyes/);
    const detail = screen.getByRole('region', { name: '0:12.4 · Misread' });
    expect(within(detail).getByText('a White Rabbit with pink eyes')).toBeTruthy();
    expect(within(detail).getByText('Misread')).toBeTruthy();
    expect(within(detail).getByText('0.42 s')).toBeTruthy();
    expect(within(detail).getByText('0:12.4')).toBeTruthy();
    expect(within(detail).getByText(/measured a clear pause/)).toBeTruthy();
    expect(within(detail).getByRole('button', { name: 'Go to in REAPER' })).toBeTruthy();
    expect(within(detail).getByRole('button', { name: 'Loop in REAPER' })).toBeTruthy();
  });

  it('plays a note with 3 s either side (PF8), and says why a note with no recording position cannot', async () => {
    const user = userEvent.setup();
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    renderPage();
    await openFinding(user, /pink eyes/);
    await user.click(screen.getByRole('button', { name: 'Play ±3 s' }));
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy();

    const entityRow = (await rows()).find((row) => /Story Bible entry/.test(row.textContent ?? ''));
    await user.click(entityRow!);
    expect((await screen.findByRole('button', { name: 'Play ±3 s' })).hasAttribute('disabled')).toBe(true);
  });

  it('offers the proofer’s sheet in and out on the notes header (D85 #8)', async () => {
    renderPage();
    await rows();
    expect(screen.getByRole('button', { name: 'Import proofer sheet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export for proofer' })).toBeTruthy();
  });

  it('records a decision with its note, says so, and updates the list and the counts', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    const review = vi.spyOn(api, 'findingsReview');
    await openFinding(user, /pink eyes/);
    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'Re-record the line');
    await user.click(screen.getByRole('button', { name: 'Pickup' }));
    expect(await screen.findByText('Saved: needs a pickup.')).toBeTruthy();
    expect(review).toHaveBeenCalledWith({
      id: WIRE_FINDINGS[0].id,
      evidenceVersion: WIRE_FINDINGS[0].evidence_version,
      status: 'accepted',
      note: 'Re-record the line',
    });
    expect(await screen.findByText('1 need pickup')).toBeTruthy();
    expect(screen.getByText('2 to review')).toBeTruthy();
    expect((await rows())[0].textContent).toContain('Pickup');
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  it('explains a decision refused on changed evidence in plain words, shows the latest version and keeps the note', async () => {
    const user = userEvent.setup();
    const { api } = renderPage({ initial: { findingsRerun: true } });
    const review = vi.spyOn(api, 'findingsReview');
    await openFinding(user, /pink eyes/);
    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'Pale is fine');
    await user.click(screen.getByRole('button', { name: 'Waive' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Not saved: this finding changed since you opened it, because its check ran again\./);
    expect((screen.getByRole('textbox', { name: 'Note (optional)' }) as HTMLTextAreaElement).value).toBe('Pale is fine');
    await user.click(screen.getByRole('button', { name: 'Waive' }));
    expect(await screen.findByText('Saved: waived.')).toBeTruthy();
    expect(review).toHaveBeenLastCalledWith(expect.objectContaining({ evidenceVersion: `${WIRE_FINDINGS[0].evidence_version}-rerun`, note: 'Pale is fine' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the host’s own reason when a decision is refused for anything else', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: { findingsReview: () => Promise.reject(new Error('the findings file could not be written')) } });
    await openFinding(user, /pink eyes/);
    await user.click(screen.getByRole('button', { name: 'Defer' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Not saved: the findings file could not be written');
  });

  it('will not send a note over the host’s limit', async () => {
    const user = userEvent.setup();
    renderPage();
    await openFinding(user, /pink eyes/);
    const note = screen.getByRole('textbox', { name: 'Note (optional)' });
    await user.click(note);
    await user.paste('x'.repeat(2001));
    expect(screen.getByText('A note can be at most 2000 characters.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Pickup' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a finding is not in the latest run', async () => {
    const user = userEvent.setup();
    renderPage();
    await rows();
    await openFilters(user);
    await user.click(screen.getByRole('switch', { name: 'Include findings the latest run did not repeat' }));
    await waitFor(async () => expect(await rows()).toHaveLength(5));
    await openFinding(user, /Antipathies/);
    expect(screen.getByText(/The latest run did not find this again/)).toBeTruthy();
    expect(screen.getByText('low')).toBeTruthy();
    expect(screen.getByText('In the script')).toBeTruthy();
  });

  it('opens the manuscript at the finding’s line, and the Story Bible at its entry', async () => {
    const user = userEvent.setup();
    const { goToManuscript, goToStoryBible } = renderPage();
    await openFinding(user, /pink eyes/);
    await user.click(screen.getByRole('button', { name: 'Show in Script' }));
    await waitFor(() => expect(goToManuscript).toHaveBeenCalledWith('chapter-1', 1));
    await openFinding(user, /.White Rabbit.Story Bible/);
    await user.click(screen.getByRole('button', { name: 'Open in Story Bible' }));
    expect(goToStoryBible).toHaveBeenCalledWith('white-rabbit');
  });

  // edit-and-proof-workspace.prd.md Phase 4: "Open in workspace" from a finding, deep-linking to it (?finding=<id>).
  it('opens the chapter workspace on the finding when the caller has one', async () => {
    const user = userEvent.setup();
    const goToWorkspace = vi.fn();
    renderPage({ goToWorkspace });
    await openFinding(user, /pink eyes/);
    await user.click(screen.getByRole('button', { name: 'Open chapter view' }));
    expect(goToWorkspace).toHaveBeenCalledWith('chapter-1', '1a2b3c4d5e6f708192a3b4c5');
  });

  it('renders no Open in workspace button when the caller has none', async () => {
    const user = userEvent.setup();
    renderPage();
    await openFinding(user, /pink eyes/);
    expect(screen.queryByRole('button', { name: 'Open chapter view' })).toBeNull();
  });

  it('keeps Show in Script off, with the reason, when there is no manuscript', async () => {
    const user = userEvent.setup();
    renderPage({ hasManuscript: false });
    await openFinding(user, /pink eyes/);
    expect((screen.getByRole('button', { name: 'Show in Script' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('group', { name: 'Import a manuscript to open this finding in it.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open in Story Bible' })).toBeNull();
  });

  it('pages a long queue with Show more', async () => {
    const user = userEvent.setup();
    const many: Finding[] = Array.from({ length: 130 }, (_, index) => ({
      ...WIRE_FINDINGS[0],
      id: `f${String(index).padStart(3, '0')}`,
    }));
    renderPage({ initial: { findings: many } });
    expect(await rows()).toHaveLength(100);
    expect(screen.getByText('Showing 100 of 130')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(async () => expect(await rows()).toHaveLength(130));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('shows a load error with Retry when the first load fails', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderPage({
      overrides: {
        findingsSummary: () =>
          fail
            ? Promise.reject(new Error('no project is open'))
            : Promise.resolve({
                total: 0,
                unreviewed: 0,
                accepted: 0,
                dismissed: 0,
                deferred: 0,
                notInLatestRun: 0,
                analyzers: [],
                categories: [],
                chapters: [],
              }),
      },
    });
    expect(await screen.findByText('This page could not be loaded')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'No notes yet' })).toBeTruthy();
  });
});

// Go to, Loop and Stop in REAPER (review dashboard Phase 7), against the mock's REAPER.
describe('ProofPage in REAPER', () => {
  const inReaper = () => within(screen.getByRole('heading', { name: 'In REAPER' }).parentElement!);
  const button = (name: string) => inReaper().getByRole('button', { name }) as HTMLButtonElement;

  it('goes to a finding and says where REAPER put the cursor', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    const goTo = vi.spyOn(api, 'findingsGoTo');
    await openFinding(user, /pink eyes/);
    await waitFor(() => expect(button('Go to in REAPER').disabled).toBe(false));
    await user.click(button('Go to in REAPER'));
    expect(await inReaper().findByText('REAPER selected the item and moved the cursor to 0:12.4.')).toBeTruthy();
    expect(goTo).toHaveBeenCalledWith('1a2b3c4d5e6f708192a3b4c5');
  });

  it('loops a finding, offers Stop, and Stop says the selection is back', async () => {
    const user = userEvent.setup();
    renderPage();
    await openFinding(user, /pink eyes/);
    await waitFor(() => expect(button('Loop in REAPER').disabled).toBe(false));
    expect(inReaper().queryByRole('button', { name: 'Stop loop' })).toBeNull();
    await user.click(button('Loop in REAPER'));
    expect(await inReaper().findByText(/Looping 0:10.4 to 0:14.4 in REAPER/)).toBeTruthy();
    await user.click(await inReaper().findByRole('button', { name: 'Stop loop' }));
    expect(await inReaper().findByText('Loop stopped. Your time selection and repeat are back as you had them.')).toBeTruthy();
    await waitFor(() => expect(inReaper().queryByRole('button', { name: 'Stop loop' })).toBeNull());
  });

  it('says a loop is playing on another finding, and Stop is offered there too', async () => {
    const user = userEvent.setup();
    renderPage();
    await openFinding(user, /pink eyes/);
    await waitFor(() => expect(button('Loop in REAPER').disabled).toBe(false));
    await user.click(button('Loop in REAPER'));
    await inReaper().findByRole('button', { name: 'Stop loop' });
    await openFinding(user, /Oh dear!/);
    expect(await inReaper().findByText('A loop is playing in REAPER on another finding.')).toBeTruthy();
    expect(button('Stop loop')).toBeTruthy();
  });

  it('shows a stale finding as an alert in plain words', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { reaper: 'stale' } });
    await openFinding(user, /pink eyes/);
    await waitFor(() => expect(button('Go to in REAPER').disabled).toBe(false));
    await user.click(button('Go to in REAPER'));
    expect((await inReaper().findByRole('alert')).textContent).toContain("This finding's item is no longer in the REAPER project, so nothing was moved.");
  });

  it('says REAPER is recording when it refuses to move', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { reaper: 'recording' } });
    await openFinding(user, /pink eyes/);
    await waitFor(() => expect(button('Loop in REAPER').disabled).toBe(false));
    await user.click(button('Loop in REAPER'));
    expect((await inReaper().findByRole('alert')).textContent).toBe('REAPER is recording, so nothing was moved. Stop recording first.');
  });

  it.each([
    ['not-running', /REAPER is not answering/],
    ['standalone', /open this app from the Narration Utils action in REAPER/],
  ] as const)('turns the buttons off with the reason when REAPER is %s, and sends nothing', async (reaper, reason) => {
    const user = userEvent.setup();
    const { api } = renderPage({ initial: { reaper } });
    const goTo = vi.spyOn(api, 'findingsGoTo');
    await openFinding(user, /pink eyes/);
    expect(await inReaper().findByText(reason)).toBeTruthy();
    expect(button('Go to in REAPER').disabled).toBe(true);
    expect(button('Loop in REAPER').disabled).toBe(true);
    expect(button('Add marker in REAPER').disabled).toBe(true);
    expect(goTo).not.toHaveBeenCalled();
  });

  it('turns the buttons off for a finding from an older check with no REAPER item', async () => {
    const user = userEvent.setup();
    renderPage();
    await rows();
    await openFilters(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'dismissed');
    await waitFor(async () => expect(await rows()).toHaveLength(1));
    await openFinding(user, /and then/);
    expect(await inReaper().findByText(/came from an older check/)).toBeTruthy();
    expect(button('Go to in REAPER').disabled).toBe(true);
    expect(button('Loop in REAPER').disabled).toBe(true);
  });

  it('has no REAPER controls for a finding with no audio, such as a Story Bible entry', async () => {
    const user = userEvent.setup();
    renderPage();
    await rows();
    await openFilters(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Check' }), 'story-bible');
    await waitFor(async () => expect(await rows()).toHaveLength(1));
    await openFinding(user, /White Rabbit/);
    await screen.findByRole('heading', { level: 3, name: 'Decision' });
    expect(screen.queryByRole('heading', { name: 'In REAPER' })).toBeNull();
  });

  it('keeps the buttons off with the reason when the status cannot be read', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: { findingsReaperStatus: () => Promise.reject(new Error('host gone')) } });
    await openFinding(user, /pink eyes/);
    expect(await inReaper().findByText('Could not check whether REAPER is connected: host gone')).toBeTruthy();
    expect(button('Go to in REAPER').disabled).toBe(true);
  });
});

// The approved marker (review dashboard Phase 8, ADR 0123): one take marker for an accepted finding, after a confirm.
describe('ProofPage adds an approved marker in REAPER', () => {
  const inReaper = () => within(screen.getByRole('heading', { name: 'In REAPER' }).parentElement!);
  const addMarker = () => inReaper().getByRole('button', { name: 'Add marker in REAPER' }) as HTMLButtonElement;
  const MARKER = "MISREAD: 'a White Rabbit with pink eyes' as 'a white rabbit with pale eyes'";

  const acceptPinkEyes = async (user: ReturnType<typeof userEvent.setup>) => {
    await openFinding(user, /pink eyes/);
    await waitFor(() => expect(inReaper().getByRole('button', { name: 'Go to in REAPER' }).hasAttribute('disabled')).toBe(false));
    expect(addMarker().disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Pickup' }));
    await screen.findByText('Saved: needs a pickup.');
    await waitFor(() => expect(addMarker().disabled).toBe(false));
  };

  it('is off until the finding is accepted, asks first, then says what REAPER added', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    const add = vi.spyOn(api, 'findingsAddMarker');
    await acceptPinkEyes(user);
    await user.click(addMarker());
    const dialog = await screen.findByRole('alertdialog', { name: 'Add a marker in REAPER' });
    expect(dialog.textContent).toContain('one Undo in REAPER removes it');
    expect(add).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Add marker' }));
    expect(await inReaper().findByText(`Marker added in REAPER: ${MARKER}. One Undo in REAPER removes it.`)).toBeTruthy();
    expect(add).toHaveBeenCalledWith('1a2b3c4d5e6f708192a3b4c5');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('adds nothing when the narrator cancels', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    const add = vi.spyOn(api, 'findingsAddMarker');
    await acceptPinkEyes(user);
    await user.click(addMarker());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(add).not.toHaveBeenCalled();
  });

  it('says so when the take already has the marker', async () => {
    const user = userEvent.setup();
    renderPage();
    await acceptPinkEyes(user);
    for (let press = 0; press < 2; press += 1) {
      await user.click(addMarker());
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Add marker' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    }
    expect(await inReaper().findByText(`This take already has a marker here (${MARKER}), so none was added.`)).toBeTruthy();
  });

  it('shows a stale finding as an alert and adds nothing', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { reaper: 'stale' } });
    await acceptPinkEyes(user);
    await user.click(addMarker());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Add marker' }));
    expect((await inReaper().findByRole('alert')).textContent).toContain('so no marker was added');
  });

  it('lists a delivery finding by its file and rule, and opens Master & QC on them instead of the manuscript', async () => {
    const user = userEvent.setup();
    const delivery: Finding = {
      schema_version: 1,
      id: 'delivery-rms',
      analyzer: 'measure',
      project: { path: 'C:/Projects/Alice' },
      source: { file: 'C:/Projects/Alice/renders/Chapter 01.wav' },
      category: 'delivery_qc',
      severity: 'error',
      confidence: 1,
      confidence_reason: 'deterministic measurement of the decoded samples',
      evidence: {
        rule: 'acx.rms',
        rule_label: 'RMS',
        metric: 'rms_dbfs',
        unit: 'dBFS',
        profile: 'acx@2026-09',
        profile_name: 'ACX (September 2026)',
        value: -24.1,
        violation: 'below_min',
        limit_min: -23,
        limit_max: -18,
        requirement: 'Each file measures between -23 dB and -18 dB RMS.',
      },
      evidence_version: 'sha256:1',
      review: { status: 'unreviewed' },
    };
    const { api, goToMaster, goToManuscript } = renderPage({ initial: { findings: [...WIRE_FINDINGS, delivery] } });
    const row = (await rows()).find((candidate) => candidate.textContent?.includes('RMS −24.1 dBFS, below the minimum of −23'));
    expect(row?.textContent).toContain('Chapter 01.wav');
    expect(row?.textContent).toContain('Delivery check');
    await openFinding(user, /RMS −24\.1 dBFS/);

    const detail = await screen.findByRole('region', { name: 'Delivery check' });
    expect(within(detail).getByText('File')).toBeTruthy();
    expect(within(detail).getByText('Each file measures between -23 dB and -18 dB RMS.')).toBeTruthy();
    expect(within(detail).queryByRole('button', { name: 'Show in Script' })).toBeNull();
    await user.click(within(detail).getByRole('button', { name: 'Open in Master & QC' }));
    expect(goToMaster).toHaveBeenCalledWith('C:/Projects/Alice/renders/Chapter 01.wav', 'acx.rms');
    expect(goToManuscript).not.toHaveBeenCalled();

    // Dismissed like any other finding, against the evidence version it was shown with.
    await user.click(within(detail).getByRole('button', { name: 'Waive' }));
    expect(await within(detail).findByText('Saved: waived.')).toBeTruthy();
    expect((await api.findingsGet('delivery-rms')).review.status).toBe('dismissed');
  });
});

// Dashboard integration (audacity-integration.prd.md Phase 9): take management has no Audacity analog, so REAPER's
// Go to/Loop/Add marker and the take-review and take-comparison sections are left out entirely for an Audacity session,
// not shown disabled - everything else about a finding (its evidence, its decision) works exactly as it does for REAPER.
describe('ProofPage with Audacity', () => {
  it('has no REAPER controls for a finding with audio, and every other action still works', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { daw: { daw: 'Audacity' } } });
    await openFinding(user, /pink eyes/);
    const detail = screen.getByRole('region', { name: '0:12.4 · Misread' });
    expect(within(detail).getByText('a White Rabbit with pink eyes')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'In REAPER' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go to in REAPER' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Loop in REAPER' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add marker in REAPER' })).toBeNull();
    expect(within(detail).getByRole('button', { name: 'Play ±3 s' })).toBeTruthy();
    expect(within(detail).getByRole('button', { name: 'Show in Script' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Pickup' }));
    expect(await screen.findByText('Saved: needs a pickup.')).toBeTruthy();
  });
});
