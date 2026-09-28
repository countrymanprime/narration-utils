// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { deliveryReportExportSchema, measureJobSchema } from '../../api/schemas/measure';
import type { ExportJob, MeasureJob, NarrationApi, PackageJob } from '../../types';
import { MasterQcPage } from './MasterQcPage';
import type { MasterFocus } from './masterLink';

afterEach(cleanup);

type Initial = Parameters<typeof createMockApi>[1];

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', name), 'utf8'));

// The host's own payloads (written by bindings_measure_contract_test.go), so the page is tested against what the host sends.
const contract = (name: string): MeasureJob => measureJobSchema.parse(fixture(name));

function renderPage({ overrides = {}, initial = {}, focus }: { overrides?: Partial<NarrationApi>; initial?: Initial; focus?: MasterFocus } = {}) {
  const api = createMockApi(overrides, initial);
  const openSettings = vi.fn();
  render(
    <ApiProvider api={api}>
      <MasterQcPage openSettings={openSettings} focus={focus} />
    </ApiProvider>,
  );
  return { api, openSettings };
}

/** A host that measures the picked files at its first poll and answers the success payload as the host pins it (judged against ACX). */
const measuresAtOnce = (change: (job: MeasureJob) => MeasureJob = (job) => job): Partial<NarrationApi> => {
  const success = contract('measure-success.json');
  return {
    measurePickFiles: async () => ({ paths: success.files.map((file) => file.path) }),
    measureAnalyze: vi.fn<NarrationApi['measureAnalyze']>().mockResolvedValue(contract('measure-running.json')),
    measureState: vi.fn<NarrationApi['measureState']>().mockResolvedValueOnce(contract('measure-idle.json')).mockResolvedValue(change(success)),
  };
};

const rowFor = async (name: string) => {
  const table = await screen.findByRole('table', { name: 'Per-file checks' });
  const row = within(table)
    .getAllByRole('row')
    .find((candidate) => candidate.textContent?.includes(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

const EXPORTED: ExportJob = {
  id: 'export-1',
  kind: 'render_export',
  phase: 'success',
  message: 'Prepared 1 file.',
  percent: 100,
  master: true,
  format: 'mp3',
  logs: [],
  elapsed: 3,
  files: [{ kind: 'chapter', title: 'ch1', path: 'C:/render/ch1.wav', status: 'done', encodedPath: 'C:/encoded/01.mp3' }],
};

describe('MasterQcPage', () => {
  it('is Master & QC, with a platform tab per profile and the mock’s actions, before anything is measured', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Master & QC', level: 1 })).toBeTruthy();
    const platforms = await screen.findByRole('group', { name: 'Delivery platform' });
    expect(within(platforms).getByRole('button', { name: 'ACX', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Master all to spec…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check files…' })).toBeTruthy();
    expect(await screen.findByText(/^Nothing measured yet/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Delivery package · ACX' })).toBeTruthy();
  });

  it('names the profile the project is judged against, with every rule and its source', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('ACX (September 2026)')).toBeTruthy();
    expect(screen.getByText('Built in · read-only')).toBeTruthy();
    expect(screen.getByText('9 checked by the app')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Rules and their sources/ }));
    const rules = screen.getByRole('table', { name: 'Rules and their sources' });
    expect(within(rules).getAllByRole('row')).toHaveLength(14);
    expect(within(rules).getByText('Measured: −23 to −18 dBFS')).toBeTruthy();
  });

  it('checks each file with the mock’s columns, and says a file fails in words as well as colour', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: measuresAtOnce() });
    await user.click(await screen.findByRole('button', { name: 'Check files…' }));

    expect(await screen.findByText('Measured 2 of 3 files; 1 could not be measured. Judged against ACX (September 2026).')).toBeTruthy();
    expect(screen.getByText('1 rule not met in 1 file: sample rate in Chapter 01.wav.')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Per-file checks' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['File', 'Length', 'RMS', 'True peak', 'Noise floor', 'Head / Tail', 'Result']);
    const chapter = await rowFor('Chapter 01.wav');
    expect(chapter.textContent).toContain('30:43');
    expect(chapter.textContent).toContain('−21.2');
    expect(chapter.textContent).toContain('−3.1');
    expect(chapter.textContent).toContain('−66.8');
    expect(chapter.textContent).toContain('0.8 / 2.5');
    expect(within(chapter).getByText('Fail')).toBeTruthy();
    expect(chapter.textContent).toContain('1 to check yourself');

    const silent = await rowFor('Chapter 02.wav');
    expect(within(silent).getAllByText('Not measurable')).toHaveLength(3);
    expect(within(silent).getByText('Not judged')).toBeTruthy();
    expect((await rowFor('Chapter 03.mp3')).textContent).toContain('Could not be measured: not a RIFF/WAVE file');
    expect(screen.getByRole('button', { name: 'Re-check 3 files' })).toBeTruthy();
  });

  it('explains why the failing file fails, with a suggested fix, beside the book’s consistency', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: measuresAtOnce() });
    await user.click(await screen.findByRole('button', { name: 'Check files…' }));
    const why = await screen.findByRole('region', { name: 'Chapter 01.wav · Why it fails' });
    expect(within(why).getByText('Sample rate 48 kHz: not 44.1 kHz.')).toBeTruthy();
    expect(within(why).getByText('Suggested fix: Render it again at 44.1 kHz, then re-check.')).toBeTruthy();
    expect(within(why).getByRole('region', { name: 'Book consistency' })).toBeTruthy();

    await user.click(within(why).getByRole('button', { name: 'Every rule' }));
    const detail = await screen.findByRole('table', { name: 'Chapter 01.wav, rule by rule' });
    const format = within(detail)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('acx.format'));
    expect(format?.textContent).toContain('Not checked by the app');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('table', { name: 'Chapter 01.wav, rule by rule' })).toBeNull();
  });

  it('re-checks the last measurement’s files without picking them again', async () => {
    const user = userEvent.setup();
    const overrides = measuresAtOnce();
    renderPage({ overrides });
    await user.click(await screen.findByRole('button', { name: 'Check files…' }));
    await user.click(await screen.findByRole('button', { name: 'Re-check 3 files' }));
    await waitFor(() => expect(overrides.measureAnalyze).toHaveBeenCalledTimes(2));
    expect(vi.mocked(overrides.measureAnalyze!).mock.calls[1][0]).toEqual(contract('measure-success.json').files.map((file) => file.path));
  });

  it('makes a platform tab the project’s delivery profile, and reads the measurement again judged by it', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    const deliverySelectProfile = vi.spyOn(api, 'deliverySelectProfile');
    const copy = await api.deliveryDuplicateProfile('acx', '2026-09');
    cleanup();
    render(
      <ApiProvider api={api}>
        <MasterQcPage openSettings={vi.fn()} />
      </ApiProvider>,
    );
    const platforms = await screen.findByRole('group', { name: 'Delivery platform' });
    await user.click(within(platforms).getByRole('button', { name: copy.name }));
    await waitFor(() => expect(deliverySelectProfile).toHaveBeenCalledWith('project', copy.id, ''));
    expect(await screen.findByRole('heading', { name: `Delivery package · ${copy.name}` })).toBeTruthy();
  });

  it('shows the mastering chain the book masters with as its steps, read-only', async () => {
    renderPage();
    const steps = await screen.findByRole('list', { name: 'Mastering steps' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((step) => step.textContent),
    ).toEqual(['EQ · High-pass at 80 Hz', "Limiter · Peaks held 0.5 dB under the profile's peak limit", "Gain · Toward the profile's RMS target"]);
    expect(screen.getByText(/One chain for the book: Built-in chain \(EQ, limiter, gain\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit chain/ })).toBeNull();
  });

  it('masters all to spec: picks files, masters and encodes them, and shows each file’s result', async () => {
    const user = userEvent.setup();
    const exportStart = vi.fn<NarrationApi['exportStart']>().mockResolvedValue(EXPORTED);
    renderPage({
      overrides: {
        exportPickFiles: async () => ({ paths: ['C:/render/ch1.wav'] }),
        exportState: vi.fn<NarrationApi['exportState']>().mockResolvedValue({ ...EXPORTED, phase: 'idle', files: [] }),
        exportStart,
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Master all to spec…' }));
    await screen.findByText('ch1.wav');
    expect(screen.getByRole('checkbox', { name: /Master before encoding/, checked: true })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Master & encode' }));
    expect(await screen.findByText('Ready')).toBeTruthy();
    expect(exportStart).toHaveBeenCalledWith({ items: [{ kind: 'chapter', title: 'ch1', path: 'C:/render/ch1.wav' }], master: true, format: 'mp3' });
  });

  it('shows an export refusal without starting a job', async () => {
    const user = userEvent.setup();
    renderPage({
      overrides: {
        exportPickFiles: async () => ({ paths: ['C:/render/ch1.wav'] }),
        exportStart: async () => Promise.reject(new Error('an export is already running')),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Master all to spec…' }));
    await screen.findByText('ch1.wav');
    await user.click(screen.getByRole('button', { name: 'Master & encode' }));
    expect((await screen.findByRole('alert')).textContent).toContain('an export is already running');
  });

  it('builds the platform’s package from the encoded files, with its checklist and outputs', async () => {
    const user = userEvent.setup();
    const built: PackageJob = {
      id: 'package-1',
      kind: 'render_package',
      phase: 'success',
      message: 'Built the acx package.',
      profile: 'acx@2026-09',
      outputDir: 'C:/Delivery/ACX',
      files: [{ kind: 'chapter', name: '01 - ch1.mp3', destPath: 'C:/Delivery/ACX/01 - ch1.mp3', tagged: true }],
      checklist: [{ ruleId: 'acx.credits', label: 'Credits files', status: 'missing', detail: 'No opening credits file.' }],
      elapsed: 1,
    };
    const packageStart = vi.fn<NarrationApi['packageStart']>().mockResolvedValue(built);
    renderPage({ overrides: { exportState: async () => EXPORTED, packageStart } });
    const panel = await screen.findByRole('region', { name: 'Delivery package · ACX' });
    await user.click(within(panel).getByRole('button', { name: 'Build packages' }));
    await waitFor(() =>
      expect(packageStart).toHaveBeenCalledWith({
        profileId: 'acx',
        profileVersion: '2026-09',
        items: [{ kind: 'chapter', title: 'ch1', path: 'C:/encoded/01.mp3' }],
      }),
    );
    const checklist = await within(panel).findByRole('list', { name: 'Package checklist' });
    expect(checklist.textContent).toContain('Credits files: Missing');
    expect(within(panel).getByRole('heading', { name: 'Outputs' })).toBeTruthy();
    expect(within(panel).getByText('01 - ch1.mp3')).toBeTruthy();
    expect(within(panel).getByText('Built the acx package.')).toBeTruthy();
  });

  it('says what the package waits on before anything is mastered', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: measuresAtOnce() });
    await user.click(await screen.findByRole('button', { name: 'Check files…' }));
    const panel = await screen.findByRole('region', { name: 'Delivery package · ACX' });
    await waitFor(() => expect(within(panel).getByText('Waiting on 1 failing check and files mastered and encoded (Master all to spec…).')).toBeTruthy());
    expect(within(panel).getByRole('button', { name: 'Build packages' })).toHaveProperty('disabled', true);
  });

  it('shows a running measurement with its real progress, and Cancel keeps what was measured', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { measure: 'hold' } });
    await user.click(await screen.findByRole('button', { name: 'Check files…' }));
    const bar = await screen.findByRole('progressbar', { name: 'Measuring' });
    expect(bar.getAttribute('aria-valuenow')).toBe('16');
    expect((await rowFor('Chapter 01.wav')).textContent).toContain('Being measured now.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/^Measurement cancelled\. 0 of 3 files were measured\./)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says so when the measurement broke, and shows the host’s refusal to start', async () => {
    const user = userEvent.setup();
    renderPage({ initial: { measure: 'fails' } });
    await user.click(await screen.findByRole('button', { name: 'Check files…' }));
    expect(await screen.findByText('The measurement stopped unexpectedly. Choose the files again to measure them.')).toBeTruthy();
    cleanup();

    const measureAnalyze = vi.fn<NarrationApi['measureAnalyze']>().mockRejectedValue(new Error('a measurement is already running'));
    renderPage({ overrides: { measureAnalyze, measurePickFiles: async () => ({ paths: ['C:/Renders/Chapter 01.wav'] }) } });
    await user.click(await screen.findByRole('button', { name: 'Check files…' }));
    expect((await screen.findByRole('alert')).textContent).toContain('a measurement is already running');
  });

  it('says so when the profiles cannot be read', async () => {
    renderPage({ overrides: { deliveryProfiles: async () => Promise.reject(new Error('the profiles file is locked')) } });
    expect((await screen.findByRole('alert')).textContent).toBe('The delivery profile could not be read: the profiles file is locked');
  });

  it('exports a report of what was measured', async () => {
    const user = userEvent.setup();
    const pinned = deliveryReportExportSchema.parse(fixture('delivery-report-export.json'));
    const deliveryExportReport = vi.fn<NarrationApi['deliveryExportReport']>().mockResolvedValue(pinned);
    renderPage({ overrides: { ...measuresAtOnce(), deliveryExportReport } });
    await user.click(await screen.findByRole('button', { name: 'Check files…' }));
    await screen.findByText(/^Measured 2 of 3 files; 1 could not be measured\./);
    await user.click(screen.getByRole('button', { name: 'Export report' }));
    expect(deliveryExportReport).toHaveBeenLastCalledWith(false);
    expect(await screen.findByText(pinned.htmlFile)).toBeTruthy();
  });

  it('opens Settings at the delivery profiles', async () => {
    const user = userEvent.setup();
    const { openSettings } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Change profile' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  // Delivery findings on Proof (delivery-platform-profiles.prd.md Phase 9): "Open in Master & QC" lands here on the file.
  it('opens on the file and rule a Proof finding names, rule by rule', async () => {
    const measured = contract('measure-success.json');
    renderPage({ overrides: { measureState: async () => measured }, focus: { file: 'C:/Renders/Chapter 01.wav', rule: 'acx.sample_rate' } });
    expect(await screen.findByRole('table', { name: 'Chapter 01.wav, rule by rule' })).toBeTruthy();
    expect(screen.getByText('Opened from a note on Proof: sample rate in Chapter 01.wav.')).toBeTruthy();
  });

  it('says so when the file a Proof finding names is not in the last measurement', async () => {
    renderPage({ focus: { file: 'C:/Renders/Chapter 09.wav', rule: 'acx.rms' } });
    expect(await screen.findByText('Chapter 09.wav is not in the last measurement. Check it again to measure it and see its rules.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: /rule by rule/ })).toBeNull();
  });
});
