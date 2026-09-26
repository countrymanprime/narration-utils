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

const measuresAtOnce = (): Partial<NarrationApi> => {
  const success = contract('measure-success.json');
  return {
    measurePickFiles: async () => ({ paths: success.files.map((file) => file.path) }),
    measureAnalyze: async () => contract('measure-running.json'),
    measureState: vi.fn<NarrationApi['measureState']>().mockResolvedValueOnce(contract('measure-idle.json')).mockResolvedValue(success),
  };
};

const rowFor = async (name: string) => {
  const table = await screen.findByRole('table', { name: 'Book checklist' });
  const row = within(table)
    .getAllByRole('row')
    .find((candidate) => candidate.textContent?.includes(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

describe('Book checklist (delivery-platform-profiles.prd.md Phase 7)', () => {
  it('shows immediately, before any file is measured: credits and the retail sample are project facts, not measurements', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Delivery' });
    expect(await screen.findByRole('heading', { name: 'Book checklist' })).toBeTruthy();
    // Nothing measured yet: Channels (the one book rule that needs a report) reads not-measurable, never a pass.
    expect(within(await rowFor('Channels')).getByText('No measured file to judge.')).toBeTruthy();
  });

  it('lists every book-scope rule of the profile once files are measured, judged against the host answer', async () => {
    renderPage({ overrides: measuresAtOnce() });
    (await screen.findByRole('button', { name: 'Choose files to measure…' })).click();
    await waitFor(async () => expect(within(await rowFor('Channels')).getByText(/Not met/)).toBeTruthy());
    expect(within(await rowFor('Channels')).getByText('The measured files do not all agree.')).toBeTruthy();
    expect(within(await rowFor('One section per file')).getByText(/Listen:/)).toBeTruthy();
  });

  it('shows credits and retail-sample facts from the project as a bonus line, never as a pass', async () => {
    renderPage({ overrides: measuresAtOnce() });
    await screen.findByRole('heading', { name: 'Book checklist' });
    await waitFor(async () => expect((await rowFor('Credits files')).textContent).toMatch(/credits template/));
    expect(within(await rowFor('Credits files')).getByText('Not checked by the app', { exact: true })).toBeTruthy();
    await waitFor(async () => expect((await rowFor('Retail sample')).textContent).toMatch(/retail sample/i));
  });
});
