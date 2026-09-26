// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS, WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';
import { chapterName } from '../../chapterName';
import type { NarrationApi } from '../../types';
import { WorkspacePage } from './WorkspacePage';

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

const chapter = WIRE_CHAPTERS[0];
const linkedTrackGuid = WIRE_TRACKS_PROJECT.tracks[0].guid;

function renderWorkspace(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}) {
  const api = createMockApi(overrides, {
    chapterTrackMappings: [{ trackGuid: linkedTrackGuid, chapterId: chapter.id, chapterTitle: chapter.title, confirmedAt: '2026-01-01T00:00:00Z' }],
    ...initial,
  });
  render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[`/tracks/chapter/${chapter.id}`]}>
        <Routes>
          <Route path="/tracks/chapter/:chapterId" element={<WorkspacePage notify={() => {}} />} />
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  );
  return api;
}

describe('WorkspacePage', () => {
  it('shows the chapter’s name and a current check state', async () => {
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: chapterName(chapter) })).toBeTruthy();
    expect(await screen.findByText('Check current')).toBeTruthy();
  });

  it('renders the script’s words and a flag from the alignment', async () => {
    renderWorkspace();
    await screen.findByRole('heading', { name: chapterName(chapter) });
    expect(await screen.findByText(/Flags/)).toBeTruthy();
    // The mock places one deterministic misread flag on a current, fully-recorded chapter.
    expect(await screen.findByText('Misread')).toBeTruthy();
  });

  it('plays from a clicked word', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('heading', { name: chapterName(chapter) });
    const words = await screen.findAllByRole('button', { name: /./ });
    const wordButton = words.find((button) => button.hasAttribute('data-token-index'));
    expect(wordButton).toBeTruthy();
    await user.click(wordButton!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy());
  });

  it('toggles play/pause from the transport', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('heading', { name: chapterName(chapter) });
    await user.click(await screen.findByRole('button', { name: 'Play' }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('shows the "not checked yet" state, with no player, for a chapter never checked', async () => {
    const neverChecked = WIRE_CHAPTERS[9]; // status 'proofing'/'not_started' tier, no recordedFraction seeded
    render(
      <ApiProvider
        api={createMockApi(
          {},
          {
            chapterTrackMappings: [
              {
                trackGuid: WIRE_TRACKS_PROJECT.tracks[0].guid,
                chapterId: neverChecked.id,
                chapterTitle: neverChecked.title,
                confirmedAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
        )}
      >
        <MemoryRouter initialEntries={[`/tracks/chapter/${neverChecked.id}`]}>
          <Routes>
            <Route path="/tracks/chapter/:chapterId" element={<WorkspacePage notify={() => {}} />} />
          </Routes>
        </MemoryRouter>
      </ApiProvider>,
    );
    expect(await screen.findAllByText(/hasn’t been checked yet/)).not.toHaveLength(0);
  });

  it('shows a message when the chapter has no linked track', async () => {
    renderWorkspace({}, { chapterTrackMappings: [] });
    expect(await screen.findByText(/isn’t linked to a REAPER track yet/)).toBeTruthy();
  });
});
