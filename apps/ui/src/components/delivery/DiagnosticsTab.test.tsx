// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { diagnosticsJobSchema } from '../../api/schemas/diagnostics';
import type { DiagnosticsJob, NarrationApi } from '../../types';
import { DeliveryPage } from './DeliveryPage';

afterEach(cleanup);

type Initial = Parameters<typeof createMockApi>[1];

// The host's own payloads (written by bindings_diagnostics_contract_test.go), so the tab is tested against what the host sends.
const contract = (name: string): DiagnosticsJob =>
  diagnosticsJobSchema.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', name), 'utf8')));

async function openDiagnostics({ overrides = {}, initial = {} }: { overrides?: Partial<NarrationApi>; initial?: Initial } = {}) {
  const user = userEvent.setup();
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <DeliveryPage openSettings={vi.fn()} />
    </ApiProvider>,
  );
  await user.click(await screen.findByRole('tab', { name: 'Diagnostics' }));
  return { api, user };
}

/** A host that checks the picked files at its first poll and answers the success payload. */
const checksAtOnce = (): Partial<NarrationApi> => ({
  measurePickFiles: async () => ({ paths: contract('diagnostics-success.json').files.map((file) => file.path) }),
  diagnosticsAnalyze: vi.fn<NarrationApi['diagnosticsAnalyze']>().mockResolvedValue(contract('diagnostics-running.json')),
  diagnosticsState: vi
    .fn<NarrationApi['diagnosticsState']>()
    .mockResolvedValueOnce(contract('diagnostics-idle.json'))
    .mockResolvedValue(contract('diagnostics-success.json')),
});

const rowOf = (table: HTMLElement, text: string) => {
  const row = within(table)
    .getAllByRole('row')
    .find((candidate) => candidate.textContent?.includes(text));
  if (!row) throw new Error(`no row with ${text}`);
  return row;
};

describe('Delivery, Diagnostics tab', () => {
  it('shows every threshold before anything is checked, and says nothing is checked yet', async () => {
    await openDiagnostics();
    const thresholds = await screen.findByRole('region', { name: 'Thresholds' });
    expect(within(thresholds).getByText('At or above full scale (0.0 dBFS), in runs of 3 or more samples')).toBeTruthy();
    expect(within(thresholds).getByText('A change of 4.0 LU or more')).toBeTruthy();
    expect(within(thresholds).getByText('2.0 s or longer, only from transcript timing')).toBeTruthy();
    expect(screen.getByText(/Nothing checked yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Check the measured files/ })).toBeNull();
  });

  it('checks picked files and lists each finding with its time, measured value, threshold and source, read-only', async () => {
    const overrides = checksAtOnce();
    const { user } = await openDiagnostics({ overrides });
    await user.click(screen.getByRole('button', { name: 'Raw recordings' }));
    await user.click(screen.getByRole('button', { name: 'Rendered chapters' }));
    await user.click(screen.getByRole('button', { name: 'Choose files to check…' }));

    expect(overrides.diagnosticsAnalyze).toHaveBeenCalledWith(
      contract('diagnostics-success.json').files.map((file) => file.path),
      'processed_render',
    );
    expect(await screen.findByText('Checked 2 of 3 files; 1 could not be checked.')).toBeTruthy();
    const findings = screen.getByRole('table', { name: 'Findings' });
    const shift = rowOf(findings, 'Level shift');
    expect(within(shift).getByText('15:05.0 – 15:06.0')).toBeTruthy();
    expect(within(shift).getByText('−19.5 to −25.3 LUFS (−5.8 LU)')).toBeTruthy();
    expect(within(shift).getByText('A change of 4.0 LU or more')).toBeTruthy();
    expect(within(shift).getByText('Chapter 01.wav')).toBeTruthy();
    expect(within(shift).getByText('Rendered chapter, whole file')).toBeTruthy();
    expect(within(rowOf(findings, 'Room-tone change')).getByText('Info')).toBeTruthy();
    expect(within(rowOf(findings, 'Clipping')).getByText('Warning')).toBeTruthy();
    // Read-only: nothing to decide, play or send to REAPER here.
    expect(within(findings).queryAllByRole('button')).toEqual([]);
    expect(screen.getByText(/nothing here is saved, played or changed/i)).toBeTruthy();

    const files = screen.getByRole('table', { name: 'Checked files' });
    expect(within(rowOf(files, 'Chapter 02.wav')).getByText('Not available: no transcript timing for this audio')).toBeTruthy();
    expect(within(rowOf(files, 'Chapter 03.mp3')).getByText('Could not be checked: not a RIFF/WAVE file')).toBeTruthy();
    expect(screen.getByText('Checked 2 of 3 files; 1 could not be checked.')).toBeTruthy();
    expect(screen.getByText('3 findings to listen to.')).toBeTruthy();
  });

  it('checks the files already measured without picking them again', async () => {
    const { api, user } = await openDiagnostics();
    await user.click(screen.getByRole('tab', { name: 'Measurements' }));
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));
    await waitFor(async () => expect((await api.measureState()).phase).not.toBe('running'), { timeout: 10_000 });
    await user.click(screen.getByRole('tab', { name: 'Diagnostics' }));
    await user.click(await screen.findByRole('button', { name: 'Check the 3 measured files' }));
    expect(await screen.findByRole('table', { name: 'Findings' }, { timeout: 10_000 })).toBeTruthy();
    expect((await api.diagnosticsState()).sourceKind).toBe('processed_render');
  }, 20_000);

  it('says so when nothing crossed a threshold, without calling it a pass', async () => {
    const quiet = contract('diagnostics-success.json');
    const none = { ...quiet, files: quiet.files.slice(1, 2), message: 'Checked 1 file.' };
    await openDiagnostics({ overrides: { diagnosticsState: async () => none } });
    expect(await screen.findByText(/Nothing reached a threshold in the checked files\. That is not a pass/)).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Findings' })).toBeNull();
  });

  it('shows a running check with its real progress, and Cancel', async () => {
    const { user, api } = await openDiagnostics({ initial: { diagnostics: 'hold' } });
    await api.measurePickFiles();
    await user.click(screen.getByRole('button', { name: 'Choose files to check…' }));
    expect(await screen.findByRole('progressbar', { name: 'Checking' })).toBeTruthy();
    expect(screen.getByText('Checking Chapter 01.wav (1 of 3).')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Raw recordings' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Diagnostics cancelled. 0 of 3 files were checked.')).toBeTruthy();
  });

  it('says so when the check broke, and shows the host’s refusal to start', async () => {
    await openDiagnostics({ overrides: { diagnosticsState: async () => contract('diagnostics-error.json') } });
    expect(await screen.findByText(/The diagnostics stopped unexpectedly\. Choose the files again/)).toBeTruthy();
    cleanup();

    const { user } = await openDiagnostics({
      overrides: { diagnosticsAnalyze: async () => Promise.reject(new Error('a diagnostics check is already running')) },
    });
    await user.click(screen.getByRole('button', { name: 'Choose files to check…' }));
    expect((await screen.findByRole('alert')).textContent).toContain('a diagnostics check is already running');
  });
});
