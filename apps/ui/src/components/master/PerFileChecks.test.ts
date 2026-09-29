import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureJobSchema } from '../../api/schemas/measure';
import { uniformFormat } from './PerFileChecks';

const measured = measureJobSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', 'measure-success.json'), 'utf8')),
);
const first = measured.files.find((file) => file.status === 'measured' && file.report);
if (!first?.report) throw new Error('no measured file');

describe('uniformFormat', () => {
  it('says the shared format once when every measured file has it, so a row need not repeat it', () => {
    expect(uniformFormat([first, { ...first, path: 'other.wav' }])).toMatch(/^All files \d[\d.]* kHz · /);
  });

  it('says nothing when the formats differ, so each row keeps its own', () => {
    const other = { ...first, path: 'other.wav', report: { ...first.report!, sample_rate: first.report!.sample_rate === 48000 ? 44100 : 48000 } };
    expect(uniformFormat([first, other])).toBeUndefined();
  });
});
