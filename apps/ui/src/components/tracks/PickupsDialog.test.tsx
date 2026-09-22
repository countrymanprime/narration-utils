// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PickupsDialog } from './PickupsDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

function renderDialog(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}, onClose = vi.fn()) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <PickupsDialog onClose={onClose} />
    </ApiProvider>,
  );
  return { api, onClose };
}

function csvFile(text: string): File {
  return new File([text], 'pickups.csv', { type: 'text/csv' });
}

describe('PickupsDialog', () => {
  it('shows the remaining count once seeded with an import', async () => {
    renderDialog({}, { pickups: 'import-success' });
    expect(await screen.findByText('2 pickups remaining of 2')).toBeTruthy();
  });

  it('shows "No pickups yet" before any import', async () => {
    renderDialog();
    expect(await screen.findByText('No pickups yet')).toBeTruthy();
  });

  it('imports a CSV file and reports the result, with Next disabled until it lands', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog();
    const importSpy = vi.spyOn(api, 'pickupsImport');

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, csvFile('start,note,tag\n1.5,Mispronounced,narrator\n9.25,Second pickup,\n'));

    await waitFor(() => expect(importSpy).toHaveBeenCalledWith('start,note,tag\n1.5,Mispronounced,narrator\n9.25,Second pickup,\n'));
    expect(await screen.findByText('2 pickups remaining of 2')).toBeTruthy();
  });

  it('reports rows that could not be used without throwing away the ones that could', async () => {
    const user = userEvent.setup();
    renderDialog();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, csvFile('1.5,Good row\nnot-a-number,Bad row\n'));

    expect(await screen.findByText(/1 row could not be used/)).toBeTruthy();
    expect(screen.getByText(/line 2: could not parse this row/)).toBeTruthy();
  });

  it('jumps to the next pickup and offers to mark it done', async () => {
    const user = userEvent.setup();
    renderDialog({}, { pickups: 'import-success' });

    await user.click(await screen.findByRole('button', { name: 'Next pickup' }));

    expect(await screen.findByText(/Mispronounced/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark this pickup done' })).toBeTruthy();
  });

  it('resolves the pickup that was jumped to', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog({}, { pickups: 'import-success' });
    const resolveSpy = vi.spyOn(api, 'pickupsResolve');

    await user.click(await screen.findByRole('button', { name: 'Next pickup' }));
    await screen.findByRole('button', { name: 'Mark this pickup done' });
    await user.click(screen.getByRole('button', { name: 'Mark this pickup done' }));

    await waitFor(() => expect(resolveSpy).toHaveBeenCalledWith(9.25));
    expect(await screen.findByText(/Marked done/)).toBeTruthy();
  });

  it('shows a REAPER error state', async () => {
    renderDialog({}, { pickups: 'error' });
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('Narration Utils script'))).toBe(true);
  });

  it('disables Close while a run is in flight', async () => {
    const user = userEvent.setup();
    renderDialog();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, csvFile('1.5,First\n'));

    await waitFor(() => expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true));
  });
});
