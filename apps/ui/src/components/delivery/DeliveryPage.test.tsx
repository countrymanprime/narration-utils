// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { deliveryReportExportSchema, measureJobSchema } from '../../api/schemas/measure';
import type { MeasureJob, NarrationApi } from '../../types';
import { DeliveryPage } from './DeliveryPage';

afterEach(cleanup);

type Initial = Parameters<typeof createMockApi>[1];

// The host's own payloads (written by bindings_measure_contract_test.go), so the page is tested against what the host sends.
const contract = (name: string): MeasureJob =>
  measureJobSchema.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', name), 'utf8')));

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

/** A host that measures the picked files at its first poll and answers the success payload as the host pins it (judged against ACX). */
const measuresAtOnce = (change: (job: MeasureJob) => MeasureJob = (job) => job): Partial<NarrationApi> => {
  const success = contract('measure-success.json');
  return {
    measurePickFiles: async () => ({ paths: success.files.map((file) => file.path) }),
    measureAnalyze: async () => contract('measure-running.json'),
    measureState: vi.fn<NarrationApi['measureState']>().mockResolvedValueOnce(contract('measure-idle.json')).mockResolvedValue(change(success)),
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
  it('names the profile the project is judged against, with every rule and its source, before anything is measured', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('ACX (September 2026)')).toBeTruthy();
    expect(screen.getByText('Built in · read-only')).toBeTruthy();
    expect(screen.getByText('6 checked by the app')).toBeTruthy();
    expect(screen.getByText('5 not checked by the app')).toBeTruthy();
    expect(screen.getByText('2 listen')).toBeTruthy();
    expect(screen.getByText('6 to verify')).toBeTruthy();
    expect(await screen.findByText(/Nothing measured yet/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Rules and their sources/ }));
    const rules = screen.getByRole('table', { name: 'Rules and their sources' });
    expect(within(rules).getAllByRole('row')).toHaveLength(14);
    expect(within(rules).getByRole('columnheader', { name: 'ACX requires' })).toBeTruthy();
    expect(within(rules).getByText('Measured: −23 to −18 dBFS')).toBeTruthy();
    expect(within(rules).getByText(/The WAV is measured; check the MP3 you upload/)).toBeTruthy();
    expect(within(rules).getByText('Conflicting sources')).toBeTruthy();
    expect(within(rules).getByText('“Opening and closing credits should be separate files”')).toBeTruthy();
  });

  it('judges each measured file rule by rule, a silent file as not measurable and a rule the app cannot check as not checked', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: measuresAtOnce() });
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));

    expect(await screen.findByText('Measured 2 of 3 files; 1 could not be measured. Judged against ACX (September 2026).')).toBeTruthy();
    expect(screen.getByText('1 rule not met in 1 file: sample rate in Chapter 01.wav.')).toBeTruthy();
    expect(screen.getByText(/3 rules per file are not checked by the app \(room tone at the head and tail and MP3 format\)/)).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Measurements' });
    expect(within(table).getByRole('columnheader', { name: /RMS\s+−23 to −18 dBFS/ })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: /Room tone\s+head · tail/ })).toBeTruthy();

    const chapter = await rowFor('Chapter 01.wav');
    expect(chapter.textContent).toContain('−21.2');
    expect(chapter.textContent).toContain('48 kHz · stereo');
    expect(chapter.textContent).toContain('Not met not 44.1 kHz');
    expect(within(chapter).getAllByText('Not checked')).toHaveLength(2);
    expect(chapter.textContent).toContain('1 not met');
    expect(chapter.textContent).toContain('4 met · 3 not checked');

    const silent = await rowFor('Chapter 02.wav');
    expect(within(silent).getAllByText('Not measurable')).toHaveLength(3);
    expect(silent.textContent).toContain('3 not checked · 3 not measurable');
    expect(screen.getByText(/It is never counted as met/)).toBeTruthy();

    expect((await rowFor('Chapter 03.mp3')).textContent).toContain('Could not be measured: not a RIFF/WAVE file');
  });

  it('opens a file against the profile, rule by rule, with the requirement and its verification', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: measuresAtOnce() });
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));
    await user.click(await rowFor('Chapter 01.wav'));

    const detail = await screen.findByRole('table', { name: 'Chapter 01.wav, rule by rule' });
    expect(screen.getByText('Chapter 01.wav against ACX (September 2026)')).toBeTruthy();
    expect(screen.getByText(/Loudness −19.4 LUFS \(information: ACX sets no LUFS rule\)/)).toBeTruthy();
    const rate = within(detail)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('acx.sample_rate'));
    expect(rate?.textContent).toContain('Not met');
    expect(rate?.textContent).toContain('not 44.1 kHz');
    const format = within(detail)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('acx.format'));
    expect(format?.textContent).toContain('Not checked by the app');
    expect(format?.textContent).toContain('This is a WAV render; check the MP3 you upload.');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('table', { name: 'Chapter 01.wav, rule by rule' })).toBeNull();
  });

  it('shows a custom profile, what it is based on, and its rules turned off', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { deliveryProfile: 'custom' } });
    expect(await screen.findByText('My ACX, tighter peak')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByText(/Custom, based on ACX \(September 2026\), revision 3/)).toBeTruthy();
    expect(screen.getByText('2 off')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Rules and their sources/ }));
    const rules = screen.getByRole('table', { name: 'Rules and their sources' });
    expect(within(rules).getByRole('columnheader', { name: 'Requirement' })).toBeTruthy();
    expect(within(rules).getByText('Measured: ≤ −3.5 dBFS')).toBeTruthy();
    expect(within(rules).getAllByText(/^Off: not judged/)).toHaveLength(2);
  });

  it('says why the project’s own choice of profile could not be used', async () => {
    const user = userEvent.setup();
    const notice = 'The delivery profile this project chose is no longer there, so it is judged against the Global default.';
    renderPage({ overrides: measuresAtOnce((job) => ({ ...job, profileNotice: notice })) });
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));
    expect((await screen.findByRole('status')).textContent).toBe(notice);
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
    expect(await screen.findByText(/^Measurement cancelled\. 0 of 3 files were measured\./)).toBeTruthy();
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

  it('says so when the profiles cannot be read', async () => {
    renderPage({ overrides: { deliveryProfiles: async () => Promise.reject(new Error('the profiles file is locked')) } });
    expect((await screen.findByRole('alert')).textContent).toBe('The delivery profile could not be read: the profiles file is locked');
  });

  it('exports a report of what was measured, with file names only unless the narrator includes locations', async () => {
    const user = userEvent.setup();
    const pinned = deliveryReportExportSchema.parse(
      JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', 'delivery-report-export.json'), 'utf8')),
    );
    const deliveryExportReport = vi.fn<NarrationApi['deliveryExportReport']>().mockResolvedValue(pinned);
    renderPage({ overrides: { ...measuresAtOnce(), deliveryExportReport } });
    await user.click(await screen.findByRole('button', { name: 'Choose files to measure…' }));
    await screen.findByText(/^Measured 2 of 3 files; 1 could not be measured\./);

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

  it('opens Settings at the Delivery profile', async () => {
    const user = userEvent.setup();
    const { openSettings } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Change profile' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
