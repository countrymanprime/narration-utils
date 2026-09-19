// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TracksPage } from './TracksPage';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

function renderTracksPage(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <TracksPage />
    </ApiProvider>,
  );
  return api;
}

describe('TracksPage', () => {
  it('lists every track from the resolved REAPER project', async () => {
    renderTracksPage();

    expect(await screen.findByRole('button', { name: /Chapter 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chapter 2/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Click Track/ })).toBeTruthy();
  });

  it('flags every track that has a missing or unsupported item', async () => {
    renderTracksPage();
    await screen.findByRole('button', { name: /Chapter 2/ });

    // Chapter 2's source is missing on disk, and Click Track's item is MIDI (unsupported).
    expect(screen.getAllByTitle("This track has an item that can't be played")).toHaveLength(2);
  });

  it('plays the selected track and toggles to a pause control', async () => {
    const user = userEvent.setup();
    renderTracksPage();
    await screen.findByRole('button', { name: /Chapter 1/ });

    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('disables playback controls for a track with no playable audio', async () => {
    const user = userEvent.setup();
    renderTracksPage();
    await screen.findByRole('button', { name: /Click Track/ });

    await user.click(screen.getByRole('button', { name: /Click Track/ }));

    const playButton = screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement;
    expect(playButton.disabled).toBe(true);
  });

  it('prompts for a choice when more than one .rpp file is found, then loads tracks once one is picked', async () => {
    const user = userEvent.setup();
    const api = renderTracksPage({
      tracksDiscover: async () => ({ candidates: ['C:/Book/Draft.rpp', 'C:/Book/Final.rpp'], selected: '' }),
    });
    const tracksSelect = vi.spyOn(api, 'tracksSelect');

    expect(await screen.findByText('Choose a REAPER project file')).toBeTruthy();
    await user.click(screen.getByText('C:/Book/Final.rpp'));

    await waitFor(() => expect(tracksSelect).toHaveBeenCalledWith('C:/Book/Final.rpp'));
    expect(await screen.findByRole('button', { name: new RegExp(WIRE_TRACKS_PROJECT.tracks[0].name) })).toBeTruthy();
  });

  it('carries a real mock selection through discover -> select -> list when seeded with two .rpp candidates', async () => {
    const user = userEvent.setup();
    const api = renderTracksPage({}, { tracksCandidates: ['C:/Book/Draft.rpp', 'C:/Book/Final.rpp'] });

    expect(await screen.findByText('Choose a REAPER project file')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Chapter 1/ })).toBeNull();
    await user.click(screen.getByText('C:/Book/Final.rpp'));

    expect(await screen.findByRole('button', { name: /Chapter 1/ })).toBeTruthy();
    await expect(api.tracksDiscover()).resolves.toEqual({ candidates: ['C:/Book/Draft.rpp', 'C:/Book/Final.rpp'], selected: 'C:/Book/Final.rpp' });
  });

  it('shows a readable error when discovery fails', async () => {
    renderTracksPage({ tracksDiscover: async () => Promise.reject(new Error('open a project before viewing tracks')) });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('open a project before viewing tracks');
  });
});
