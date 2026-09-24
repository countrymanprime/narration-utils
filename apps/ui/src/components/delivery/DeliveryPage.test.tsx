// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { judgeMockFile } from '../../api/measureMock';
import { deliveryReportExportSchema, measureJobSchema } from '../../api/schemas/measure';
import type { MeasureJob, NarrationApi } from '../../types';
import { DeliveryPage } from './DeliveryPage';

afterEach(cleanup);

type Initial = Parameters<typeof createMockApi>[1];

// The host's own payloads (written by bindings_measure_contract_test.go), so the page is tested against what the host sends.
const contract = (name: string): MeasureJob =>
  measureJobSchema.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', name), 'utf8')));

const LIMITS = { integrated_lufs_min: '-23', integrated_lufs_max: '-18', rms_dbfs_min: '-20', true_peak_dbtp_max: '-3.5', noise_floor_dbfs_max: '-70' };

function renderPage({ overrides = {}, initial = {} }: { overrides?: Partial<NarrationApi>; initial?: Initial } = {}) {
  const api = createMockApi(overrides, initial);
  const openSettings = vi.fn();
  render(
    <ApiProvider api={api}>
      <DeliveryPage openSettings={openSettings} />
    </ApiProvider>,
  );
  return { api, openSettings };
}

/**
 * A host that measures the picked files at its first poll and answers the success payload, as the host pins it (judged against a
 * true-peak limit of -3.5 dBTP) or, given `limits`, judged against those by measure.Evaluate's rules.
 */
const measuresAtOnce = (limits?: Record<string, string>, change: (job: MeasureJob) => MeasureJob = (job) => job): Partial<NarrationApi> => {
  const success = contract('measure-success.json');
  const judged = limits ? { ...success, files: success.files.map((file) => ({ ...file, findings: judgeMockFile(file, limits) })) } : success;
  return {
    measurePickFiles: async () => ({ paths: success.files.map((file) => file.path) }),
    measureAnalyze: async () => contract('measure-running.json'),
    measureState: vi.fn<NarrationApi['measureState']>().mockResolvedValueOnce(contract('measure-idle.json')).mockResolvedValue(change(judged)),
  };
};

const rowFor = async (name: string) => {
  const table = await screen.findByRole('table', { name: 'Measurements' });
  const row = within(table)
    .getAllByRole('row')
    .find((candidate) => candidate.textContent?.includes(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

describe('DeliveryPage', () => {
  it('says nothing is measured yet and that no limits are set, so nothing reads as a pass', async () => {
    renderPage();
    expect(await screen.findByText(/No limits set\. Every value is reported without being checked/)).toBeTruthy();
    expect(await screen.findByText(/Nothing measured yet/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('measures the picked files and lists every value with its unit, a silent file as not measurable, and a file it could not read', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: measuresAtOnce({}) });
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));

    expect(await screen.findByText('Measured 2 of 3 files; 1 could not be measured.')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Measurements' });
    expect(within(table).getByRole('columnheader', { name: 'Loudness (LUFS)' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'True peak (dBTP)' })).toBeTruthy();

    const chapter = await rowFor('Chapter 01.wav');
    expect(chapter.textContent).toContain('−19.4');
    expect(chapter.textContent).toContain('48 kHz · stereo');
    expect(chapter.textContent).toContain('30:43');
    expect(chapter.textContent).not.toContain('above');

    const silent = await rowFor('Chapter 02.wav');
    expect(within(silent).getAllByText('Not measurable')).toHaveLength(5);
    expect(screen.getByText(/It is never counted as within a limit/)).toBeTruthy();

    expect((await rowFor('Chapter 03.mp3')).textContent).toContain('Could not be measured: not a RIFF/WAVE file');
  });

  it('marks each value outside the narrator’s limits with the limit it broke, and counts them', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: measuresAtOnce(LIMITS), initial: { deliveryLimits: LIMITS } });
    expect(await screen.findByText('−23.0 to −18.0 LUFS')).toBeTruthy();
    expect(screen.getByText('at most −3.5 dBTP')).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));

    expect(await screen.findByText('3 values are outside your limits.')).toBeTruthy();
    const chapter = await rowFor('Chapter 01.wav');
    expect(chapter.textContent).toContain('below −20.0');
    expect(chapter.textContent).toContain('above −3.5');
    expect(chapter.textContent).toContain('above −70.0');
    // A silent file is not measurable, never within: it adds nothing to the count and has no "above" or "below".
    expect((await rowFor('Chapter 02.wav')).textContent).not.toMatch(/above|below/);
  });

  it('shows a running measurement with its real progress, and Cancel keeps what was measured', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { measure: 'hold' } });
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));

    const bar = await screen.findByRole('progressbar', { name: 'Measuring' });
    expect(bar.getAttribute('aria-valuenow')).toBe('16');
    expect(screen.getByText('Measuring Chapter 01.wav (1 of 3).')).toBeTruthy();
    expect((await rowFor('Chapter 01.wav')).textContent).toContain('Being measured now.');
    expect((await rowFor('Chapter 03.mp3')).textContent).toContain('Waiting to be measured.');
    expect(screen.getByRole('button', { name: 'Choose files to measure…' }).hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Measurement cancelled. 0 of 3 files were measured.')).toBeTruthy();
    expect((await rowFor('Chapter 01.wav')).textContent).toContain('Not measured: the measurement was cancelled.');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('picks up a measurement that is still running when the page opens', async () => {
    const api = createMockApi({}, { measure: 'hold' });
    await api.measurePickFiles();
    await api.measureAnalyze(['C:/Users/Narrator/Renders/Alice/Chapter 01.wav']);
    render(
      <ApiProvider api={api}>
        <DeliveryPage openSettings={() => {}} />
      </ApiProvider>,
    );
    expect(await screen.findByRole('progressbar', { name: 'Measuring' })).toBeTruthy();
  });

  it('says so when the measurement broke, with the reason on the file it broke on', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { measure: 'fails' } });
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));

    expect(await screen.findByText('The measurement stopped unexpectedly. Choose the files again to measure them.')).toBeTruthy();
    expect((await rowFor('Chapter 01.wav')).textContent).toContain('Could not be measured: the measurement stopped unexpectedly');
    expect((await rowFor('Chapter 02 (silent).wav')).textContent).toContain('Not measured: the measurement was cancelled.');
  });

  it('shows the host’s refusal to start, and does nothing when the picker is closed', async () => {
    const user = userEvent.setup();
    const measureAnalyze = vi.fn<NarrationApi['measureAnalyze']>().mockRejectedValue(new Error('a measurement is already running'));
    const measurePickFiles = vi
      .fn<NarrationApi['measurePickFiles']>()
      .mockResolvedValueOnce({ paths: [] })
      .mockResolvedValue({ paths: ['C:/Renders/Chapter 01.wav'] });
    renderPage({ overrides: { measureAnalyze, measurePickFiles } });
    const choose = await screen.findByRole('button', { name: 'Choose files to measure…' });

    await user.click(choose);
    await waitFor(() => expect(measurePickFiles).toHaveBeenCalledTimes(1));
    expect(measureAnalyze).not.toHaveBeenCalled();

    await user.click(choose);
    expect((await screen.findByRole('alert')).textContent).toContain('a measurement is already running');
  });

  it('marks a value the host found outside a limit, from the host’s own payload', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: measuresAtOnce() });
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));
    expect(await screen.findByText('1 value is outside your limits.')).toBeTruthy();
    expect((await rowFor('Chapter 01.wav')).textContent).toContain('above −3.5');
  });

  it('judges nothing when the host cannot read the limits, and says why', async () => {
    const user = userEvent.setup();
    const unreadable = (job: MeasureJob): MeasureJob => ({
      ...job,
      limitsError: 'delivery limit true_peak_dbtp_max is "loud", which is not a finite number',
      files: job.files.map((file) => ({ ...file, findings: [] })),
    });
    renderPage({ overrides: { ...measuresAtOnce(undefined, unreadable), settingsForScope: async () => Promise.reject(new Error('settings file is locked')) } });
    expect((await screen.findByRole('alert')).textContent).toContain('Your limits could not be read, so every value is only reported: settings file is locked');
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));
    expect(await screen.findByText('Measured 2 of 3 files; 1 could not be measured.')).toBeTruthy();
    expect((await rowFor('Chapter 01.wav')).textContent).not.toMatch(/above|below/);
    const alerts = (await screen.findAllByRole('alert')).map((alert) => alert.textContent);
    expect(alerts).toContain('Your limits could not be read, so no value is judged: delivery limit true_peak_dbtp_max is "loud", which is not a finite number');
  });

  it('exports a report of what was measured, with file names only unless the narrator includes locations', async () => {
    const user = userEvent.setup();
    const pinned = deliveryReportExportSchema.parse(
      JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', 'delivery-report-export.json'), 'utf8')),
    );
    const deliveryExportReport = vi.fn<NarrationApi['deliveryExportReport']>().mockResolvedValue(pinned);
    renderPage({ overrides: { ...measuresAtOnce(), deliveryExportReport } });
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));
    await screen.findByText('Measured 2 of 3 files; 1 could not be measured.');

    await user.click(screen.getByRole('button', { name: 'Export report' }));
    expect(deliveryExportReport).toHaveBeenLastCalledWith(false);
    expect(await screen.findByText(/^Wrote/)).toBeTruthy();
    expect(screen.getByText(pinned.htmlFile)).toBeTruthy();
    expect(screen.getByText('3 files, 3 open findings of 4; file names only, no locations.')).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: /Include each file’s full location/ }));
    await user.click(screen.getByRole('button', { name: 'Export report' }));
    expect(deliveryExportReport).toHaveBeenLastCalledWith(true);
  });

  it('shows why a report was not written', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Export report' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The report was not written: nothing has been measured or checked in this session yet');
  });

  it('opens Settings at the Delivery limits', async () => {
    const user = userEvent.setup();
    const { openSettings } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Change limits' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
