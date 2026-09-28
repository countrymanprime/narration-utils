// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MOCK_ACX } from '../../api/deliveryProfilesMock';
import { measureJobSchema } from '../../api/schemas/measure';
import type { MeasureFileResult } from '../../types';
import { BookConsistency } from './BookConsistency';

afterEach(cleanup);

// The host's own success payload has one file with real levels (Chapter 01.wav); Chapter 02.wav is silent
// (not_measurable) and Chapter 03.mp3 failed to read, so this is also the "one measured file" case.
const success = measureJobSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', 'measure-success.json'), 'utf8')),
);

function renderSection(files: readonly MeasureFileResult[]) {
  render(<BookConsistency profile={MOCK_ACX} files={files} />);
  return screen.getByRole('region', { name: 'Book consistency' });
}

const rowFor = (section: HTMLElement, name: string) => within(section).getByText(name, { exact: true }).closest('div')!.parentElement as HTMLElement;

describe('Book consistency (delivery-platform-profiles.prd.md Phase 10, mock 05)', () => {
  it('shows before anything is measured, one row per numeric level rule, each reading "No measurements yet"', () => {
    const section = renderSection([]);
    expect(within(section).getByText('RMS')).toBeTruthy();
    expect(within(section).getByText('Peak')).toBeTruthy();
    expect(within(section).getByText('Noise floor')).toBeTruthy();
    expect(within(section).getAllByText('No measurements yet')).toHaveLength(3);
  });

  it('shows the book’s min, median and max once a file is measured — here, a single measured file, so min = median = max', () => {
    const section = renderSection(success.files);
    expect(rowFor(section, 'RMS').textContent).toMatch(/−21\.2 to −21\.2 dBFS, median −21\.2 dBFS/);
    expect(rowFor(section, 'Peak').textContent).toMatch(/−3\.6 to −3\.6 dBFS/);
    expect(rowFor(section, 'Noise floor').textContent).toMatch(/−66\.8 to −66\.8 dBFS/);
  });

  it('never counts the silent file’s not_measurable rows or the unread MP3, only the judged one', () => {
    const section = renderSection(success.files);
    expect(rowFor(section, 'RMS').textContent).toMatch(/Spread 0\.0 dBFS across the one measured file\./);
  });
});
