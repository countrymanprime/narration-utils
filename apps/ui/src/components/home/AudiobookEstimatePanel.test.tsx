// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
