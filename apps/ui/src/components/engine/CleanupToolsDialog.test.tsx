// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CleanupToolsDialog } from './CleanupToolsDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

function renderDialog(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}, onClose = vi.fn()) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <CleanupToolsDialog onClose={onClose} />
    </ApiProvider>,
  );
  return { api, onClose };
}

describe('CleanupToolsDialog', () => {
  it('offers exactly the two allow-listed tools', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Open Repair Pops/Clicks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Magnolius DeClick' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(2);
  });

  it('launches Repair Pops/Clicks and says nothing has changed until the narrator applies it', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog();
    const launch = vi.spyOn(api, 'cleanupToolsLaunch');
    await user.click(screen.getByRole('button', { name: 'Open Repair Pops/Clicks' }));
    expect(launch).toHaveBeenCalledWith('repair_pops_clicks');
    expect(await screen.findByText(/Repair Pops\/Clicks is open in REAPER\. Nothing has changed yet/)).toBeTruthy();
  });

  it('launches Magnolius DeClick by its own key', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog();
    const launch = vi.spyOn(api, 'cleanupToolsLaunch');
    await user.click(screen.getByRole('button', { name: 'Open Magnolius DeClick' }));
    expect(launch).toHaveBeenCalledWith('magnolius_declick');
  });

  it('shows the launched state when seeded', async () => {
    renderDialog({}, { cleanupTools: 'launched' });
    expect(await screen.findByText(/is open in REAPER/)).toBeTruthy();
  });

  it('shows REAPER’s refusal as an alert', async () => {
    renderDialog({}, { cleanupTools: 'error' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Magnolius DeClick is not installed in REAPER');
  });

  it('shows a request that the host refuses as an alert', async () => {
    const user = userEvent.setup();
    renderDialog({ cleanupToolsLaunch: () => Promise.reject(new Error('the REAPER bridge is unavailable')) });
    await user.click(screen.getByRole('button', { name: 'Open Repair Pops/Clicks' }));
    expect((await screen.findByRole('alert')).textContent).toContain('the REAPER bridge is unavailable');
  });

  it('disables both launchers and Close while a launch is in flight', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Open Repair Pops/Clicks' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Open Magnolius DeClick' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
