// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateChapterRegionsDialog } from './CreateChapterRegionsDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS, WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

const CONFIRMED_CHAPTER_1 = {
  chapterTrackMappings: [
    {
      trackGuid: WIRE_TRACKS_PROJECT.tracks[0].guid,
      chapterId: WIRE_CHAPTERS[0].id,
      chapterTitle: WIRE_CHAPTERS[0].title,
      confirmedAt: '2026-09-01T12:00:00Z',
    },
  ],
};

function renderDialog(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}, onClose = vi.fn()) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <CreateChapterRegionsDialog tracks={WIRE_TRACKS_PROJECT.tracks} onClose={onClose} />
    </ApiProvider>,
  );
  return { api, onClose };
}

describe('CreateChapterRegionsDialog', () => {
  it('skips every chapter with no confirmed track link and has nothing to create', async () => {
    renderDialog();

    expect((await screen.findAllByText(/No track is linked to this chapter\./)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Create 0 regions' })).toBeTruthy();
  });

  it('plans a region once a chapter is linked, and a chosen credits track adds its own row', async () => {
    const user = userEvent.setup();
    renderDialog({}, CONFIRMED_CHAPTER_1);

    await screen.findByRole('button', { name: 'Create 1 region' });
    // The confirmed link's track happens to be named "Chapter 1" too, so the row shows it in both the region and
    // track columns - assert there are two matches rather than one, instead of an ambiguous single getByText.
    expect(within(screen.getByRole('table', { name: 'Chapter regions' })).getAllByText(WIRE_CHAPTERS[0].title).length).toBe(2);

    const openingTrack = WIRE_TRACKS_PROJECT.tracks[1];
    await user.selectOptions(screen.getByRole('combobox', { name: 'Opening credits track' }), openingTrack.guid);

    expect(await screen.findByRole('button', { name: 'Create 2 regions' })).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Chapter regions' })).getByText('Opening credits')).toBeTruthy();
  });

  it('swallows the click and shows why while the regions capability is off (the default)', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog({}, CONFIRMED_CHAPTER_1);
    const create = vi.spyOn(api, 'chapterRegionsCreate');

    const button = await screen.findByRole('button', { name: 'Create 1 region' });
    expect(button.getAttribute('aria-disabled')).toBe('true');

    await user.click(button);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates the planned regions once the regions capability is on, and shows the counts', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog({}, { ...CONFIRMED_CHAPTER_1, daw: { toggles: { regions: 'on' } } });
    const create = vi.spyOn(api, 'chapterRegionsCreate');

    const button = await screen.findByRole('button', { name: 'Create 1 region' });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    await user.click(button);

    await waitFor(() => expect(create).toHaveBeenCalledWith('', '', false));
    expect(await screen.findByText(/^Sent 1: 1 created/)).toBeTruthy();
  });

  it('shows a REAPER error state and creates nothing', async () => {
    const user = userEvent.setup();
    renderDialog({}, { ...CONFIRMED_CHAPTER_1, daw: { toggles: { regions: 'on' } }, regionsCreateAlwaysErrors: true });

    await user.click(await screen.findByRole('button', { name: 'Create 1 region' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('REAPER refused to write the regions'))).toBe(true);
  });

  it('reports when no REAPER project is selected yet, with nothing to create', async () => {
    renderDialog({}, { tracksCandidates: [] });

    expect(await screen.findByText(/No REAPER project/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create 0 regions' })).toBeTruthy();
  });

  it('relabels Cancel to Close once regions have been created', async () => {
    const user = userEvent.setup();
    renderDialog({}, { ...CONFIRMED_CHAPTER_1, daw: { toggles: { regions: 'on' } } });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: 'Create 1 region' }));

    // The dialog's own header Close button is also named "Close" (Dialog.tsx), so once the footer button relabels
    // from "Cancel" to "Close" too there are two: assert the count rather than a single ambiguous getByRole match.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Close' }).length).toBe(2));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
