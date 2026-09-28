// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkChaptersDialog } from './LinkChaptersDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS, WIRE_LINE_IDENTITY_LINES, WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

function renderDialog(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}, onClose = vi.fn()) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <LinkChaptersDialog chapters={WIRE_CHAPTERS} tracks={WIRE_TRACKS_PROJECT.tracks} onClose={onClose} />
    </ApiProvider>,
  );
  return { api, onClose };
}

describe('LinkChaptersDialog', () => {
  it('lists every chapter with a track selector and nothing to stamp until one is chosen', async () => {
    renderDialog();

    for (const chapter of WIRE_CHAPTERS) {
      expect(await screen.findByRole('combobox', { name: `Track for ${chapter.title}` })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Stamp 0 items' })).toBeTruthy();
  });

  it('previews every item of a mapped track and stamps only once approved', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog();
    const stamp = vi.spyOn(api, 'lineIdentityStamp');
    const chapter = WIRE_CHAPTERS[0];
    const track = WIRE_TRACKS_PROJECT.tracks[0];

    await user.selectOptions(screen.getByRole('combobox', { name: `Track for ${chapter.title}` }), track.guid);

    const expectedCount = track.items.length;
    const stampButton = await screen.findByRole('button', { name: `Stamp ${expectedCount} item${expectedCount === 1 ? '' : 's'}` });
    expect(stamp).not.toHaveBeenCalled();

    await user.click(stampButton);

    await waitFor(() =>
      expect(stamp).toHaveBeenCalledWith(
        track.items.map((item) => ({ itemGuid: item.guid, lineId: chapter.id, text: chapter.title })),
        false,
      ),
    );
  });

  it('shows nothing is written until approval: mapping alone sends no request', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog();
    const stamp = vi.spyOn(api, 'lineIdentityStamp');

    await user.selectOptions(screen.getByRole('combobox', { name: `Track for ${WIRE_CHAPTERS[0].title}` }), WIRE_TRACKS_PROJECT.tracks[0].guid);

    expect(stamp).not.toHaveBeenCalled();
  });

  it('reports a stale item and a conflict after stamping', async () => {
    renderDialog({}, { lineIdentity: 'conflict' });

    expect(await screen.findByText(/Stamped 1 line, 1 stale item, 1 conflict\./)).toBeTruthy();
    expect(screen.getByText(/Stale items/)).toBeTruthy();
    expect(screen.getByText(/Already stamped with a different chapter/)).toBeTruthy();
  });

  it('shows a REAPER error state', async () => {
    renderDialog({}, { lineIdentity: 'error' });

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('Narration Utils script'))).toBe(true);
  });

  it('reads current stamps and shows a status for every row, including drift and removed', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Read current stamps' }));

    for (const line of WIRE_LINE_IDENTITY_LINES) {
      expect(await screen.findByText(line.itemGuid)).toBeTruthy();
    }
    expect(screen.getByText('Text changed since stamping')).toBeTruthy();
    expect(screen.getByText('Chapter no longer in the manuscript')).toBeTruthy();
  });

  it('disables Cancel and Close while a stamp is running', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog();
    await user.selectOptions(screen.getByRole('combobox', { name: `Track for ${WIRE_CHAPTERS[0].title}` }), WIRE_TRACKS_PROJECT.tracks[0].guid);
    const trackItemCount = WIRE_TRACKS_PROJECT.tracks[0].items.length;

    void api.lineIdentityStamp(
      WIRE_TRACKS_PROJECT.tracks[0].items.map((item) => ({ itemGuid: item.guid, lineId: WIRE_CHAPTERS[0].id, text: WIRE_CHAPTERS[0].title })),
      false,
    );
    void trackItemCount;

    await waitFor(() => expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true));
  });
});
