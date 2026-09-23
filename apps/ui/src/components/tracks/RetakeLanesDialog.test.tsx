// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetakeLanesDialog } from './RetakeLanesDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

function renderDialog(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}, onClose = vi.fn()) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <RetakeLanesDialog onClose={onClose} />
    </ApiProvider>,
  );
  return { api, onClose };
}

function statusOf(lineId: string, lane: number) {
  const line = screen.getByRole('region', { name: `${lineId} on Chapter 1` });
  const row = within(line)
    .getByRole('button', { name: `Play lane ${lane} for ${lineId} on Chapter 1` })
    .closest('li');
  return row?.textContent ?? '';
}

describe('RetakeLanesDialog', () => {
  it('lists each line’s retakes by lane, with what plays in the saved project', async () => {
    renderDialog();
    expect(await screen.findByRole('region', { name: 'line-000012 on Chapter 1' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Play lane \d for line-000012/ })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^Play lane \d for line-000013/ })).toHaveLength(2);
    expect(statusOf('line-000012', 1)).toContain('Plays');
    expect(statusOf('line-000012', 2)).toContain('Silent');
  });

  it('picks a retake by its line id and item GUID, then shows its lane playing across the whole track', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog();
    const pick = vi.spyOn(api, 'retakeLanesPick');
    await user.click(await screen.findByRole('button', { name: 'Play lane 2 for line-000012 on Chapter 1' }));
    expect(pick).toHaveBeenCalledWith('line-000012', '{3A1F0C2E-5B6D-4E7F-8091-A2B3C4D5E602}');
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/Lane 2 is now the only lane playing on Chapter 1/);
    expect(status.closest('section')?.getAttribute('aria-label')).toBe('line-000012 on Chapter 1');
    expect(statusOf('line-000012', 2)).toContain('Plays');
    expect(statusOf('line-000012', 1)).toContain('Silent');
    // The same lane now plays for the other line on the track too: lane play state is per track.
    expect(statusOf('line-000013', 2)).toContain('Plays');
    expect(statusOf('line-000013', 1)).toContain('Silent');
  });

  it('says why nothing is listed when no track uses fixed lanes', async () => {
    renderDialog({}, { retakeLanes: 'none' });
    expect(await screen.findByText(/No track in the saved project uses fixed item lanes/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Play lane/ })).toBeNull();
  });

  it('says there is nothing to choose when lane tracks hold no line on two lanes', async () => {
    renderDialog({ retakeLanesList: async () => ({ laneTracks: 2, lines: [] }) });
    expect(await screen.findByText(/No line has retakes on more than one lane/)).toBeTruthy();
  });

  it('shows REAPER’s refusal as an alert under the line it was for', async () => {
    renderDialog({}, { retakeLanes: 'error' });
    await screen.findByRole('region', { name: 'line-000012 on Chapter 1' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('is not in fixed item lane mode');
    expect(alert.closest('section')?.getAttribute('aria-label')).toBe('line-000012 on Chapter 1');
  });

  it('shows the outcome of a pick for a retake no longer listed under the list', async () => {
    renderDialog({ retakeLanesList: async () => ({ laneTracks: 1, lines: [] }) }, { retakeLanes: 'picked' });
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Lane 2 is now the only lane playing');
    expect(status.closest('section')).toBeNull();
  });

  it('shows a list the host cannot read as an alert', async () => {
    renderDialog({ retakeLanesList: () => Promise.reject(new Error('no REAPER project (.rpp) file was found')) });
    expect((await screen.findByRole('alert')).textContent).toContain('no REAPER project (.rpp) file was found');
  });

  it('shows a pick the host refuses as an alert', async () => {
    const user = userEvent.setup();
    renderDialog({ retakeLanesPick: () => Promise.reject(new Error('the REAPER bridge is unavailable')) });
    await user.click(await screen.findByRole('button', { name: 'Play lane 3 for line-000012 on Chapter 1' }));
    expect((await screen.findByRole('alert')).textContent).toContain('the REAPER bridge is unavailable');
  });

  it('disables the other lanes and Close while a pick is in flight', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Play lane 3 for line-000012 on Chapter 1' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Play lane 1 for line-000013 on Chapter 1' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
