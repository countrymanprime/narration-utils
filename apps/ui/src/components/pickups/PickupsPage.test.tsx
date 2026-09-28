// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PickupsPage } from './PickupsPage';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS, WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

function renderPage(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}) {
  const api = createMockApi(overrides, initial);
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <PickupsPage />
      </ApiProvider>
    </MemoryRouter>,
  );
  return { api };
}

function csvFile(text: string): File {
  return new File([text], 'pickups.csv', { type: 'text/csv' });
}

// Chapter 1 linked to the mock project's first track (0 to 612.4 s), so the mock's next pickup at 9.25 s falls in it.
const CHAPTER_1_LINKED = {
  chapterTrackMappings: [
    {
      trackGuid: WIRE_TRACKS_PROJECT.tracks[0].guid,
      chapterId: WIRE_CHAPTERS[0].id,
      chapterTitle: WIRE_CHAPTERS[0].title,
      confirmedAt: '2026-09-01T12:00:00Z',
    },
  ],
};

describe('PickupsPage', () => {
  it('is a page with its own level-1 heading, not a dialog', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pickups' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the remaining count once seeded with an import', async () => {
    renderPage({}, { pickups: 'import-success' });
    expect(await screen.findByText('2 pickups remaining of 2')).toBeTruthy();
  });

  it('shows "No pickups yet" before any import', async () => {
    renderPage();
    expect(await screen.findByText('No pickups yet')).toBeTruthy();
  });

  it('imports a CSV file and reports the result', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    const importSpy = vi.spyOn(api, 'pickupsImport');

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, csvFile('start,note,tag\n1.5,Mispronounced,narrator\n9.25,Second pickup,\n'));

    await waitFor(() => expect(importSpy).toHaveBeenCalledWith('start,note,tag\n1.5,Mispronounced,narrator\n9.25,Second pickup,\n'));
    expect(await screen.findByText('2 pickups remaining of 2')).toBeTruthy();
  });

  it('reports rows that could not be used without throwing away the ones that could', async () => {
    const user = userEvent.setup();
    renderPage();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, csvFile('1.5,Good row\nnot-a-number,Bad row\n'));

    expect(await screen.findByText(/1 row could not be used/)).toBeTruthy();
    expect(screen.getByText(/line 2: could not parse this row/)).toBeTruthy();
  });

  it('jumps to the next pickup and offers to mark it done', async () => {
    const user = userEvent.setup();
    renderPage({}, { pickups: 'import-success' });

    await user.click(await screen.findByRole('button', { name: 'Next pickup' }));

    expect(await screen.findByText(/Mispronounced/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark this pickup done' })).toBeTruthy();
  });

  it("opens the pickup's chapter in Proof at the pickup's place when a linked chapter track holds it", async () => {
    const user = userEvent.setup();
    renderPage({}, { pickups: 'import-success', ...CHAPTER_1_LINKED });

    await user.click(await screen.findByRole('button', { name: 'Next pickup' }));

    const link = await screen.findByRole('link', { name: /Open Chapter 1 .* in Proof/ });
    expect(link.getAttribute('href')).toBe(`/proof/${WIRE_CHAPTERS[0].id}?t=9.25`);
  });

  it('says so when no linked chapter track holds the pickup, rather than guessing a chapter', async () => {
    const user = userEvent.setup();
    renderPage({}, { pickups: 'import-success' });

    await user.click(await screen.findByRole('button', { name: 'Next pickup' }));

    expect(await screen.findByText(/Not on a linked chapter track/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /in Proof/ })).toBeNull();
  });

  it('resolves the pickup that was jumped to', async () => {
    const user = userEvent.setup();
    const { api } = renderPage({}, { pickups: 'import-success' });
    const resolveSpy = vi.spyOn(api, 'pickupsResolve');

    await user.click(await screen.findByRole('button', { name: 'Next pickup' }));
    await user.click(await screen.findByRole('button', { name: 'Mark this pickup done' }));

    await waitFor(() => expect(resolveSpy).toHaveBeenCalledWith(9.25));
    expect(await screen.findByText(/Marked done/)).toBeTruthy();
  });

  it('punches to the pickup that was jumped to', async () => {
    const user = userEvent.setup();
    const { api } = renderPage({}, { pickups: 'import-success', daw: { toggles: { punch: 'on' } } });
    const punchSpy = vi.spyOn(api, 'pickupsPunch');

    await user.click(await screen.findByRole('button', { name: 'Next pickup' }));
    await user.click(await screen.findByRole('button', { name: 'Punch from here' }));

    await waitFor(() => expect(punchSpy).toHaveBeenCalledWith(9.25));
  });

  it('reports a punch refusal inline without touching the pickup list', async () => {
    const user = userEvent.setup();
    renderPage(
      { pickupsPunch: async () => ({ outcome: 'refused', message: 'REAPER is not answering. Check that REAPER is open, then try again.' }) },
      { pickups: 'import-success', daw: { toggles: { punch: 'on' } } },
    );

    await user.click(await screen.findByRole('button', { name: 'Next pickup' }));
    await user.click(await screen.findByRole('button', { name: 'Punch from here' }));

    expect(await screen.findByText('REAPER is not answering. Check that REAPER is open, then try again.')).toBeTruthy();
  });

  it('shows "Punch from here" disabled while the punch capability is off (the default)', async () => {
    const user = userEvent.setup();
    renderPage({}, { pickups: 'import-success' });

    await user.click(await screen.findByRole('button', { name: 'Next pickup' }));

    const button = await screen.findByRole('button', { name: 'Punch from here' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a REAPER error state', async () => {
    renderPage({}, { pickups: 'error' });
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('Narration Utils script'))).toBe(true);
  });

  it('keeps the pickup session slot honest until closed-loop proofing plans one', async () => {
    renderPage();
    const session = await screen.findByRole('region', { name: 'Pickup session' });
    expect(session.textContent).toMatch(/not available yet/i);
  });
});
