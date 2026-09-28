import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOCK_ACX } from '../../api/deliveryProfilesMock';
import { measureJobSchema } from '../../api/schemas/measure';
import type { MeasureFileResult } from '../../types';
import { fileVerdict, leftToCheck, misses, suggestedFix } from './fileVerdict';

// The host's own judged payload (bindings_measure_contract_test.go): Chapter 01 at 48 kHz, Chapter 02 silent, Chapter 03 unreadable.
const measured = measureJobSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', 'measure-success.json'), 'utf8')),
);
const file = (name: string): MeasureFileResult => {
  const found = measured.files.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

describe('fileVerdict', () => {
  it('fails a file with any rule not met, never passes one with a value it could not measure or nothing judged, and has no verdict for an unread file', () => {
    expect(fileVerdict(file('Chapter 01.wav'))).toBe('fail');
    expect(fileVerdict(file('Chapter 03.mp3'))).toBe('none');
    // A silent render meets its sample rate and length, but its levels could not be measured: no verdict, never a pass.
    expect(fileVerdict(file('Chapter 02.wav'))).toBe('none');
    const met = file('Chapter 01.wav').rules.map((result) => (result.status === 'not_met' ? { ...result, status: 'met' as const } : result));
    expect(fileVerdict({ ...file('Chapter 01.wav'), rules: met })).toBe('pass');
    expect(fileVerdict({ ...file('Chapter 01.wav'), rules: met.map((result) => ({ ...result, status: 'not_checked' as const })) })).toBe('none');
  });

  it('counts the rules left to the narrator: not checked by the app, or not measurable', () => {
    expect(leftToCheck(file('Chapter 01.wav'))).toBe(1);
    expect(leftToCheck(file('Chapter 02.wav'))).toBe(6);
  });
});

describe('misses', () => {
  it('says which rule a file missed, by how much, and what to do about it', () => {
    const [miss, ...rest] = misses(file('Chapter 01.wav'), MOCK_ACX);
    expect(rest).toHaveLength(0);
    expect(miss.text).toBe('Sample rate 48 kHz: not 44.1 kHz.');
    expect(miss.fix).toBe('Render it again at 44.1 kHz, then re-check.');
  });

  it('never promises that mastering lowers a noise floor', () => {
    const noise = MOCK_ACX.rules.find((rule) => rule.metric === 'noise_floor_dbfs');
    if (!noise) throw new Error('no noise floor rule');
    expect(suggestedFix(noise, { ruleId: noise.id, status: 'not_met', value: -57.8, violation: 'above_max' })).toMatch(
      /^Mastering does not lower the noise floor/,
    );
  });
});
