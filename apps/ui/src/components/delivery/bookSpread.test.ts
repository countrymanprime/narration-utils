import { describe, expect, it } from 'vitest';
import { MOCK_ACX } from '../../api/deliveryProfilesMock';
import type { DeliveryRuleResult, MeasureFileResult } from '../../types';
import { bookSpreadRows, spreadStat } from './bookSpread';

const result = (ruleId: string, status: DeliveryRuleResult['status'], value: number | null): DeliveryRuleResult => ({ ruleId, status, value });

const file = (name: string, rules: DeliveryRuleResult[], status: MeasureFileResult['status'] = 'measured'): MeasureFileResult => ({
  path: `C:/book/${name}`,
  name,
  status,
  report: null,
  fingerprint: null,
  findings: [],
  rules,
});

describe('spreadStat', () => {
  it('is undefined for no values, never a zero or a guess', () => {
    expect(spreadStat([])).toBeUndefined();
  });

  it('is the value itself, three times over, for one value', () => {
    expect(spreadStat([-21.2])).toEqual({ min: -21.2, max: -21.2, median: -21.2, count: 1 });
  });

  it('takes the middle value for an odd count', () => {
    expect(spreadStat([-23, -21, -19])).toEqual({ min: -23, max: -19, median: -21, count: 3 });
  });

  it('averages the two middle values for an even count', () => {
    expect(spreadStat([-22, -21, -20, -19])).toEqual({ min: -22, max: -19, median: -20.5, count: 4 });
  });
});

describe('bookSpreadRows', () => {
  it('has one row per numeric per-file level rule of the profile, in the profile’s own order', () => {
    const rows = bookSpreadRows(MOCK_ACX, []);
    expect(rows.map((row) => row.rule.id)).toEqual(['acx.rms', 'acx.peak', 'acx.noise_floor']);
  });

  it('reads only a rule’s met and not_met values, never a not_checked or not_measurable row', () => {
    const files = [
      file('Chapter 01.wav', [result('acx.rms', 'met', -21.2), result('acx.peak', 'met', -3.6), result('acx.noise_floor', 'met', -66.8)]),
      // A rule the app has not judged for this file yet (an MP3 before Phase 8, or a silent file): never counted.
      file('Chapter 02.wav', [result('acx.rms', 'not_checked', null), result('acx.peak', 'not_measurable', null), result('acx.noise_floor', 'off', null)]),
      file('Chapter 03.wav', [result('acx.rms', 'not_met', -24.5), result('acx.peak', 'met', -4.1), result('acx.noise_floor', 'met', -70.0)]),
    ];
    const rows = bookSpreadRows(MOCK_ACX, files);
    const rms = rows.find((row) => row.rule.id === 'acx.rms')!;
    expect(rms.values).toEqual([-24.5, -21.2]);
    expect(rms.stat).toEqual({ min: -24.5, max: -21.2, median: -22.85, count: 2 });
    const peak = rows.find((row) => row.rule.id === 'acx.peak')!;
    expect(peak.values).toEqual([-4.1, -3.6]);
    const noiseFloor = rows.find((row) => row.rule.id === 'acx.noise_floor')!;
    expect(noiseFloor.values).toEqual([-70, -66.8]);
  });

  it('leaves stat undefined for a rule with no judged value yet, so an empty measured set never renders a zero or a guess', () => {
    const files = [file('Chapter 01.wav', [result('acx.rms', 'not_checked', null)])];
    const rows = bookSpreadRows(MOCK_ACX, files);
    expect(rows.every((row) => row.stat === undefined)).toBe(true);
    expect(rows.every((row) => row.values.length === 0)).toBe(true);
  });

  it('ignores a file that failed or was cancelled, and a rule turned off in a custom profile', () => {
    const files = [file('Chapter 01.wav', [result('acx.rms', 'met', -21.2)], 'failed'), file('Chapter 02.wav', [result('acx.rms', 'met', -20.0)], 'cancelled')];
    expect(bookSpreadRows(MOCK_ACX, files).find((row) => row.rule.id === 'acx.rms')!.values).toEqual([]);

    const offProfile = { ...MOCK_ACX, rules: MOCK_ACX.rules.map((rule) => (rule.id === 'acx.peak' ? { ...rule, off: true } : rule)) };
    expect(bookSpreadRows(offProfile, []).map((row) => row.rule.id)).toEqual(['acx.rms', 'acx.noise_floor']);
  });
});
