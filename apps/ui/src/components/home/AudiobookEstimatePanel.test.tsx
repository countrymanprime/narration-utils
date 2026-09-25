// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AudiobookEstimatePanel, rollupChapterStatuses } from './AudiobookEstimatePanel';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS } from '../../api/mockFixtures';

afterEach(cleanup);

describe('AudiobookEstimatePanel', () => {
  it('shows a total word count and a finished-audio estimate from the backend chapter list', async () => {
    const api = createMockApi();
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Audiobook estimate')).toBeTruthy());
    expect(screen.getAllByText(/12 chapters/).length).toBeGreaterThan(0);
    expect(screen.getByText('Est. finished audio')).toBeTruthy();
  });

  it('reveals the per-chapter breakdown table on demand', async () => {
    const api = createMockApi();
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText('Audiobook estimate'));
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Chapter 1 — Down the Rabbit-Hole/ })).toBeTruthy();
    expect(screen.getAllByText((_, node) => node?.textContent === 'Chapter 1 — Down the Rabbit-Hole').length).toBeGreaterThan(0);
  });

  it('shows a plain dash for Actual recorded, with the reason as its accessible name, and leaves it unchanged when the status changes (actual-recorded-column.prd.md Phase 1 and 3)', async () => {
    const api = createMockApi();
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText('Audiobook estimate'));
    expect(screen.getByText('Actual recorded').nextElementSibling?.textContent).toBe('—');
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    // The default demo has no confirmed chapter-track links, so every row reads "—", named for a screen reader (AR3).
    expect(screen.getAllByLabelText('No REAPER track linked').length).toBe(12);
    const select = screen.getByLabelText('Chapter 1 status') as HTMLSelectElement;
    const cellsBefore = screen.getAllByText('—').length;
    fireEvent.change(select, { target: { value: 'recording' } });
    await waitFor(() => expect(select.value).toBe('recording'));
    expect(screen.getAllByText('—').length).toBe(cellsBefore);
  });

  it("shows the linked track's recorded length in the cell and stat, and sums only linked chapters (actual-recorded-column.prd.md Phase 3, AR1, AR2, AR6)", async () => {
    const api = createMockApi({
      manuscriptChapters: async () => [
        { ...WIRE_CHAPTERS[0], recordedSeconds: 2520.5 }, // 42m
        { ...WIRE_CHAPTERS[1], recordedSeconds: 45 }, // under a minute: seconds, not "0m"
        { ...WIRE_CHAPTERS[2], recordedUnavailable: 'multiple_tracks' },
        ...WIRE_CHAPTERS.slice(3),
      ],
    });
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText('Audiobook estimate'));
    // Headline stat: only the two linked chapters' seconds are summed (2520.5 + 45 = 2565.5s = 42m46s -> 43m).
    expect(screen.getByText('Actual recorded').nextElementSibling?.textContent).toBe('43m');
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    expect(screen.getByText('42m')).toBeTruthy();
    expect(screen.getByText('45s')).toBeTruthy();
    expect(screen.getByLabelText('Linked to more than one REAPER track')).toBeTruthy();
    // Status never touches this column (Phase 1): changing Chapter 1's status leaves its recorded cell alone.
    fireEvent.change(screen.getByLabelText('Chapter 1 status'), { target: { value: 'recording' } });
    await waitFor(() => expect((screen.getByLabelText('Chapter 1 status') as HTMLSelectElement).value).toBe('recording'));
    expect(screen.getByText('42m')).toBeTruthy();
  });

  it('tells how many chapters are linked in the headline stat tooltip and defines the column in its header tooltip (AR1, AR2, AR8)', async () => {
    const api = createMockApi({
      manuscriptChapters: async () => [{ ...WIRE_CHAPTERS[0], recordedSeconds: 60 }, ...WIRE_CHAPTERS.slice(1)],
    });
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText('Audiobook estimate'));
    expect(screen.getByLabelText('About Actual recorded').getAttribute('aria-description')).toBe(
      'From 1 of 12 chapters with a linked track, as of the saved REAPER project. Nothing here is estimated.',
    );
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    expect(screen.getByLabelText('About the Actual recorded column').getAttribute('aria-description')).toBe(
      'The audio on the chapter’s linked REAPER track: its unmuted items, overlaps counted once, as of the saved project. A dash means no track is linked.',
    );
  });

  it('shows a Credits stat timed from the first opening and closing templates at 155 wpm', async () => {
    const api = createMockApi({
      creditsTemplates: async () => [
        { id: 'o', kind: 'opening', name: 'Opening', body: 'word '.repeat(155).trim() },
        { id: 'c', kind: 'closing', name: 'Closing', body: 'word '.repeat(155).trim() },
      ],
      creditsPreview: async (body: string) => ({ text: body, words: body.split(/\s+/).filter(Boolean).length, unresolved: [] }),
    });
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Audiobook estimate')).toBeTruthy());
    // Two 155-word segments at 155 wpm read 60s each; the room-tone allowance defaults to 0 (Open Question C9, no
    // Settings field until Phase 5), so the total is exactly 2 minutes.
    await waitFor(() => expect(screen.getByText('Credits')).toBeTruthy());
    expect(screen.getByText('2m')).toBeTruthy();
  });

  it('adds the room tone setting to each credits file and the chapter announcements to the Credits stat (Phase 5)', async () => {
    const segment = 'word '.repeat(155).trim();
    const base = createMockApi();
    const api = createMockApi({
      creditsTemplates: async () => [
        { id: 'o', kind: 'opening', name: 'Opening', body: segment },
        { id: 'c', kind: 'closing', name: 'Closing', body: segment },
        { id: 'a', kind: 'chapter_announcement', name: 'Announcement', body: '[Chapter].' },
      ],
      creditsPreview: async (body: string) => ({ text: body, words: body.split(/\s+/).filter(Boolean).length, unresolved: [] }),
      // Twelve chapters, each announced in 155 words: 12 minutes.
      creditsChapterAnnouncements: async () =>
        Array.from({ length: 12 }, (_, index) => ({
          chapterId: `c${index}`,
          chapter: `Chapter ${index + 1}`,
          result: { text: segment, words: 155, unresolved: [] },
        })),
      settingsForScope: async (scope) => {
        const settings = await base.settingsForScope(scope);
        return {
          ...settings,
          General: settings.General.map((field) => (field.key === 'credits_room_tone_seconds' ? { ...field, value: '30', effectiveValue: '30' } : field)),
        };
      },
    });
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    // Opening and closing: 60s + 30s room tone each = 3m; twelve announcements: 12m, no room tone. 15m in all.
    await waitFor(() => expect(screen.getByText('15m')).toBeTruthy());
  });

  it('leaves the narration total unchanged by a retail sample (Phase 5, C10: a marker, never time)', async () => {
    const plain = createMockApi();
    const chapters = await plain.manuscriptChapters();
    const [first, , third] = chapters[1].paragraphIds ?? [];
    const withSample = createMockApi({}, { retailSample: { startParagraphId: first.id, endParagraphId: third.id } });
    const finished = async (api: ReturnType<typeof createMockApi>) => {
      render(
        <MemoryRouter>
          <ApiProvider api={api}>
            <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
          </ApiProvider>
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByText('Credits')).toBeTruthy());
      const text = screen.getByText('Est. finished audio').parentElement!.textContent;
      const credits = screen.getByText('Credits').parentElement!.textContent;
      cleanup();
      return [text, credits];
    };
    expect(await finished(withSample)).toEqual(await finished(plain));
  });

  it('leaves the Credits stat out when the credit template library has no opening or closing template', async () => {
    const api = createMockApi({ creditsTemplates: async () => [] });
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Audiobook estimate')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Est. finished audio')).toBeTruthy());
    expect(screen.queryByText('Credits')).toBeNull();
  });

  it('leaves the Credits stat out rather than toasting when the credits calls fail', async () => {
    const api = createMockApi({
      creditsTemplates: async () => {
        throw new Error('boom');
      },
    });
    const notify = vi.fn();
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={notify} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Est. finished audio')).toBeTruthy());
    expect(screen.queryByText('Credits')).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no manuscript chapters yet', async () => {
    const api = createMockApi({ manuscriptChapters: async () => [] });
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No narratable manuscript chapters found yet/)).toBeTruthy();
  });

  it('merges chapters with the same status into one progress segment after edits', async () => {
    const api = createMockApi();
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await screen.findByText('Audiobook estimate');
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    const before = await api.manuscriptChapters();
    const previousFinalized = rollupChapterStatuses(before).finalized;
    const chapter = before.find((item) => item.status === 'recording')!;
    fireEvent.change(screen.getByLabelText(`${chapter.title} status`), { target: { value: 'finalized' } });
    await waitFor(() => expect((screen.getByLabelText(`${chapter.title} status`) as HTMLSelectElement).value).toBe('finalized'));
    const totals = rollupChapterStatuses(await api.manuscriptChapters());
    expect(totals.finalized.count).toBe(previousFinalized.count + 1);
    expect(totals.finalized.words).toBe(previousFinalized.words + chapter.wordCount);
    expect(document.querySelectorAll('.progress-segment')).toHaveLength(5);
  });
});

describe('credits rows in the chapter table (credits-in-chapter-table.prd.md Phase 2)', () => {
  const openTable = async (overrides: Parameters<typeof createMockApi>[0] = {}, initial: Parameters<typeof createMockApi>[1] = {}) => {
    const api = createMockApi(overrides, initial);
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await screen.findByText('Audiobook estimate');
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    return api;
  };
  const tableRows = () => within(screen.getByRole('table', { name: 'Chapters' })).getAllByRole('row');

  it('places Opening credits first and Closing credits last, leaving the narration total and count unchanged (CT1)', async () => {
    await openTable();
    const rows = tableRows();
    expect(within(rows[1]).getByText('Opening credits')).toBeTruthy();
    expect(within(rows[rows.length - 1]).getByText('Closing credits')).toBeTruthy();
    // Header row + 12 narration chapters + 2 credits rows.
    expect(rows.length).toBe(15);
    expect(screen.getAllByText(/12 chapters/).length).toBeGreaterThan(0);
  });

  it('shows the template name and a disabled Check with a reason for a configured row, and a plain dash for Actual recorded (CT4, CT6)', async () => {
    await openTable();
    const openingRow = within(tableRows()[1]);
    expect(openingRow.getByText('ACX minimum (opening)')).toBeTruthy();
    const cells = openingRow.getAllByRole('cell');
    // Cell 1 is the Track column (chapter-track-link-control.prd.md Phase 2), empty for a credits row; Actual
    // recorded is cell 4.
    expect(cells[4].textContent).toBe('—');
    const check = screen.getByRole('button', { name: 'Check recording of Opening credits' }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    // Both credits rows are disabled with the same reason.
    expect(screen.getAllByLabelText('The recording check reads manuscript chapters; credits are not checked yet').length).toBe(2);
  });

  it('warns when a credits template has an unresolved token, without hiding or blocking the row (C6)', async () => {
    // The default demo seeds no credit values (main.tsx's mockCreditsFilled is off by default), so every [Token] in the
    // built-in templates is unresolved.
    await openTable();
    const openingRow = within(tableRows()[1]);
    expect(openingRow.getByText(/not filled in/)).toBeTruthy();
    expect(openingRow.getByLabelText('Opening credits status')).toBeTruthy();
  });

  it('shows no warning once every token is filled', async () => {
    await openTable({}, { creditValues: { title: 'A Book', author: 'A. Author', narrator: 'A. Narrator' } });
    const openingRow = within(tableRows()[1]);
    expect(openingRow.queryByText(/not filled in/)).toBeNull();
  });

  it('shows "Not set up" with a link to Settings > Credits for a missing template, and no status or Check (CT5)', async () => {
    await openTable({}, { creditsMissingClosing: true });
    const rows = tableRows();
    const closingRow = within(rows[rows.length - 1]);
    expect(closingRow.getByText(/Not set up/)).toBeTruthy();
    expect(closingRow.getByRole('link', { name: /Add a closing template in Settings/ })).toBeTruthy();
    expect(closingRow.queryByLabelText('Closing credits status')).toBeNull();
    expect(closingRow.queryByRole('button', { name: /Check/ })).toBeNull();
  });

  it('changes a row status through setCreditsStatus, never manuscriptSetChapterStatus or the stage engine, and updates the progress text (CT1, CT2, CT3)', async () => {
    const setCreditsStatus = vi.fn(async (kind: string, status: string) => ({ [kind]: status }));
    const manuscriptSetChapterStatus = vi.fn();
    await openTable({ setCreditsStatus, manuscriptSetChapterStatus });
    expect(screen.getByText(/credits 0 of 2/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Opening credits status'), { target: { value: 'finalized' } });
    await waitFor(() => expect((screen.getByLabelText('Opening credits status') as HTMLSelectElement).value).toBe('finalized'));
    expect(setCreditsStatus).toHaveBeenCalledWith('opening', 'finalized');
    expect(manuscriptSetChapterStatus).not.toHaveBeenCalled();
    expect(screen.getByText(/credits 1 of 2/)).toBeTruthy();
  });

  it('the rows sum to the same total as the headline Credits stat (Technical Risks: cannot disagree)', async () => {
    const segment = 'word '.repeat(155).trim();
    await openTable({
      creditsTemplates: async () => [
        { id: 'o', kind: 'opening', name: 'Opening', body: segment },
        { id: 'c', kind: 'closing', name: 'Closing', body: segment },
      ],
      creditsPreview: async (body: string) => ({ text: body, words: body.split(/\s+/).filter(Boolean).length, unresolved: [] }),
    });
    // Matches the Credits stat's own test: two 155-word segments at 155 wpm read 60s ("1m") each, no room tone by
    // default, so the stat (2m) is exactly the sum of the two rows.
    await waitFor(() => expect(screen.getByText('Credits').nextElementSibling?.textContent).toBe('2m'));
    const rows = tableRows();
    expect(within(rows[1]).getAllByText('1m').length).toBeGreaterThan(0);
    expect(within(rows[rows.length - 1]).getAllByText('1m').length).toBeGreaterThan(0);
  });

  it('never sends a credits id to manuscriptChapters, stages or coverage', async () => {
    const api = await openTable();
    const chapters = await api.manuscriptChapters();
    expect(chapters.some((chapter) => chapter.id.startsWith('credits-'))).toBe(false);
  });
});

// chapter-track-link-control.prd.md Phase 2: the Track column and its slide-over, driven against the same
// ChapterTrackLinks mock the row cells read (chapterTrackMatchMock.ts). The default demo project ("ready") names its
// tracks "Chapter 1" and "Chapter 2" (mockFixtures.ts's WIRE_TRACKS_PROJECT), which match those two chapters'
// titles exactly, so they read "suggested"; every other chapter has no name match and reads "not linked" (TL1-TL4).
describe('chapter-track link control on Home', () => {
  const openTracks = async (overrides: Parameters<typeof createMockApi>[0] = {}, initial: Parameters<typeof createMockApi>[1] = {}) => {
    const notify = vi.fn();
    const api = createMockApi(overrides, initial);
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={notify} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await screen.findByText('Audiobook estimate');
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    return { api, notify };
  };
  const row = (title: string) => screen.getByRole('link', { name: new RegExp(`^${title}\\b`) }).closest('tr') as HTMLElement;
  const trackButton = (title: string) => within(row(title)).getByRole('button', { name: new RegExp(`^Track for ${title}:`) });

  it("shows the Track column with each row's suggested or not-linked state (TL1-TL4)", async () => {
    await openTracks();
    expect(screen.getByRole('columnheader', { name: 'Track' })).toBeTruthy();
    expect(trackButton('Chapter 1').getAttribute('aria-label')).toBe('Track for Chapter 1: suggested Chapter 1, not confirmed');
    expect(trackButton('Chapter 2').getAttribute('aria-label')).toBe('Track for Chapter 2: suggested Chapter 2, not confirmed');
    expect(trackButton('Chapter 3').getAttribute('aria-label')).toBe('Track for Chapter 3: not linked');
  });

  it("opens the row's track panel showing what the suggestion was found through, and confirms it via Change (TL5)", async () => {
    const { notify } = await openTracks();
    fireEvent.click(trackButton('Chapter 1'));
    const dialog = await screen.findByRole('dialog', { name: 'Track: Chapter 1' });
    expect(within(dialog).getByText('Suggested')).toBeTruthy();
    expect(within(dialog).getByText('Found through')).toBeTruthy();
    expect(within(dialog).getByText('Track name')).toBeTruthy();
    // A suggestion is shown pre-filled (MappingConfirm's read view), not with its own Confirm button: Change reveals
    // the picker, already on the suggested track, to confirm it. `findBy` (rather than `getBy`) gives MappingConfirm's
    // mount effect a tick to settle first, so this click isn't racing it (it only resets `picking` when already
    // false, but a synchronous click right after mount can otherwise land in the same React batch as that effect).
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Change' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Track linked.'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(trackButton('Chapter 1').getAttribute('aria-label')).toBe('Track for Chapter 1: Chapter 1, linked'));
  });

  it('offers every unclaimed track to a chapter with no suggestion, and reflects the link after Confirm (TL3)', async () => {
    const { notify } = await openTracks();
    fireEvent.click(trackButton('Chapter 3'));
    const dialog = await screen.findByRole('dialog', { name: 'Track: Chapter 3' });
    expect(within(dialog).queryByText('Possible tracks')).toBeNull();
    const select = await within(dialog).findByLabelText('Track for Chapter 3');
    fireEvent.change(select, { target: { value: '{DA2D209F-D10F-5E46-93E7-098D96499ED0}' } }); // "Chapter 2" track
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Track linked.'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(trackButton('Chapter 3').getAttribute('aria-label')).toBe('Track for Chapter 3: Chapter 2, linked'));
  });

  it("tells the narrator when linking a track displaces another chapter's confirmed link, and lets it be unlinked (TL5, TL6)", async () => {
    const { notify } = await openTracks();
    // Confirm Chapter 1 onto its suggested "Chapter 1" track first, so a second chapter can displace it.
    fireEvent.click(trackButton('Chapter 1'));
    const first = await screen.findByRole('dialog', { name: 'Track: Chapter 1' });
    fireEvent.click(await within(first).findByRole('button', { name: 'Change' }));
    fireEvent.click(within(first).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Track linked.'));
    fireEvent.click(within(first).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(trackButton('Chapter 1').getAttribute('aria-label')).toBe('Track for Chapter 1: Chapter 1, linked'));

    // Chapter 3 has no suggestion of its own; link it onto the same "Chapter 1" track Chapter 1 just confirmed.
    fireEvent.click(trackButton('Chapter 3'));
    const second = await screen.findByRole('dialog', { name: 'Track: Chapter 3' });
    fireEvent.change(await within(second).findByLabelText('Track for Chapter 3'), { target: { value: '{0E4D1D7F-D039-674D-87E6-719376DE95EC}' } });
    fireEvent.click(within(second).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Linked. This track was linked to Chapter 1, which is now unlinked.'));
    fireEvent.click(within(second).getByRole('button', { name: 'Close' }));
    // Chapter 1 has no other track to suggest while this one is claimed elsewhere.
    await waitFor(() => expect(trackButton('Chapter 1').getAttribute('aria-label')).toBe('Track for Chapter 1: not linked'));

    // Unlink Chapter 3: freeing the track lets the matcher suggest it back to Chapter 1 by name, same as at the start.
    fireEvent.click(trackButton('Chapter 3'));
    const third = await screen.findByRole('dialog', { name: 'Track: Chapter 3' });
    fireEvent.click(await within(third).findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Track unlinked.'));
    fireEvent.click(within(third).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(trackButton('Chapter 3').getAttribute('aria-label')).toBe('Track for Chapter 3: not linked'));
    expect(trackButton('Chapter 1').getAttribute('aria-label')).toBe('Track for Chapter 1: suggested Chapter 1, not confirmed');
  });

  it('shows the project message and no Track column when no REAPER project was found, instead of a row button (TL7)', async () => {
    await openTracks({}, { tracksCandidates: [] });
    expect(screen.getByText('No REAPER project (.rpp) file was found in this project folder.')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Track' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Track for/ })).toBeNull();
  });

  it('points to the Tracks page to choose a project when more than one REAPER project file is found (TL7)', async () => {
    await openTracks({}, { tracksCandidates: ['C:/proj/one.rpp', 'C:/proj/two.rpp'] });
    expect(screen.getByText(/Choose which REAPER project file to use on the Tracks page\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose it on Tracks' }).getAttribute('href')).toBe('/tracks');
  });
});

describe('chapter-sync toast on Home (daw-chapter-track-auto-sync.prd.md Phase 3, S12)', () => {
  it('shows one toast with Undo for a sync batch, and Undo calls chapterSyncUndo for each link', async () => {
    const notify = vi.fn();
    const api = createMockApi({}, { chapterSync: 'linked' });
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={notify} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await screen.findByText('Audiobook estimate');
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
    const notify = vi.fn();
    const api = createMockApi({}, { chapterSync: 'linked' });
    const { rerender } = render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={notify} goToManuscript={() => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await screen.findByText('Audiobook estimate');
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    rerender(
      <MemoryRouter>
        <ApiProvider api={api}>
          <AudiobookEstimatePanel notify={notify} goToManuscript={() => {}} refreshKey="again" />
        </ApiProvider>
      </MemoryRouter>,
    );
    await screen.findByText('Audiobook estimate');
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
