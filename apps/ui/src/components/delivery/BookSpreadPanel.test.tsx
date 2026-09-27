// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { measureJobSchema } from '../../api/schemas/measure';
import type { MeasureJob, NarrationApi } from '../../types';
import { DeliveryPage } from './DeliveryPage';

afterEach(cleanup);

type Initial = Parameters<typeof createMockApi>[1];

const contract = (name: string): MeasureJob =>
  measureJobSchema.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', name), 'utf8')));

function renderPage({ overrides = {}, initial = {} }: { overrides?: Partial<NarrationApi>; initial?: Initial } = {}) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <DeliveryPage openSettings={vi.fn()} />
    </ApiProvider>,
  );
  return { api };
}

// The host's own success payload has one file with real levels (Chapter 01.wav); Chapter 02.wav is silent
// (not_measurable) and Chapter 03.mp3 failed to read, so this is also the "one measured file" case.
const measuresAtOnce = (): Partial<NarrationApi> => {
  const success = contract('measure-success.json');
  return {
    measurePickFiles: async () => ({ paths: success.files.map((file) => file.path) }),
    measureAnalyze: async () => contract('measure-running.json'),
    measureState: vi.fn<NarrationApi['measureState']>().mockResolvedValueOnce(contract('measure-idle.json')).mockResolvedValue(success),
  };
};

const rowFor = async (name: string) => {
  const panel = await screen.findByRole('heading', { name: 'Book-wide spread' });
  const rows = within(panel.closest('section') as HTMLElement).getAllByText(name, { exact: true });
  if (rows.length === 0) throw new Error(`no row for ${name}`);
  return rows[0].closest('div')!.parentElement as HTMLElement;
};

describe('Book-wide spread (delivery-platform-profiles.prd.md Phase 10)', () => {
  it('shows before anything is measured, one row per numeric level rule, each reading "No measurements yet"', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Delivery' });
    const panel = (await screen.findByRole('heading', { name: 'Book-wide spread' })).closest('section') as HTMLElement;
    expect(within(panel).getByText('RMS')).toBeTruthy();
    expect(within(panel).getByText('Peak')).toBeTruthy();
    expect(within(panel).getByText('Noise floor')).toBeTruthy();
    expect(within(panel).getAllByText('No measurements yet')).toHaveLength(3);
  });

  it('shows the book’s min, median and max once a file is measured — here, a single measured file, so min = median = max', async () => {
    renderPage({ overrides: measuresAtOnce() });
    (await screen.findByRole('button', { name: 'Choose files to measure…' })).click();
    await waitFor(async () => expect((await rowFor('RMS')).textContent).toMatch(/−21\.2 to −21\.2 dBFS, median −21\.2 dBFS/));
    expect((await rowFor('Peak')).textContent).toMatch(/−3\.6 to −3\.6 dBFS/);
    expect((await rowFor('Noise floor')).textContent).toMatch(/−66\.8 to −66\.8 dBFS/);
    expect((await rowFor('RMS')).textContent).toMatch(/Spread 0\.0 dBFS across the one measured file\./);
  });

  it('never counts the silent file’s not_measurable rows or the unread MP3, only the judged one', async () => {
    renderPage({ overrides: measuresAtOnce() });
    (await screen.findByRole('button', { name: 'Choose files to measure…' })).click();
    await waitFor(async () => expect((await rowFor('RMS')).textContent).toMatch(/median/));
    expect((await rowFor('RMS')).textContent).toMatch(/across the one measured file/);
  });
});
