// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { StatusReportPanel } from './StatusReportPanel';

afterEach(cleanup);

function renderPanel() {
  const api = createMockApi();
  render(
    <ApiProvider api={api}>
      <StatusReportPanel open onClose={() => {}} />
    </ApiProvider>,
  );
  return { api };
}

describe('StatusReportPanel', () => {
  it('writes the report and leaves the contracted amount out by default', async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Export status report' }));
    const text = (await screen.findByText(/Wrote/)).parentElement?.textContent ?? '';
    expect(text).toContain('narration-utils/production/reports');
    expect(text).toMatch(/production-status-.*\.html/);
    expect(text).toMatch(/production-status-.*\.json/);
    expect(screen.getByText('The contracted amount and effective rate are left out.')).toBeTruthy();
  });

  it('includes the contracted amount and rate once the narrator ticks the box', async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /Include the contracted amount/ }));
    await user.click(screen.getByRole('button', { name: 'Export status report' }));
    await screen.findByText(/Wrote/);
    expect(screen.getByText(/are included/)).toBeTruthy();
  });

  it('never repeats a file name across two exports', async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Export status report' }));
    const first = (await screen.findByText(/Wrote/)).parentElement?.textContent;
    await user.click(screen.getByRole('button', { name: 'Export status report' }));
    const second = (await screen.findByText(/Wrote/)).parentElement?.textContent;
    expect(first).not.toBe(second);
  });
});
