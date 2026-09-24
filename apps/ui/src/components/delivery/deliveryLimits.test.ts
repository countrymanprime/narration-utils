import { describe, expect, it } from 'vitest';
import type { ScopedSettingField } from '../../types';
import { DELIVERY_METRICS, deliveryLimitsFrom, formatLevel, formatLength, judge, setLimitCount } from './deliveryLimits';

const field = (key: string, effectiveValue: string): ScopedSettingField => ({
  key,
  label: key,
  kind: 'number',
  choices: [],
  value: effectiveValue,
  isSet: effectiveValue !== '',
  effectiveValue,
  effectiveSource: effectiveValue === '' ? 'hardcoded' : 'project',
  number: { min: -100, max: 0, step: 0.1, unit: 'dBFS' },
});

describe('deliveryLimitsFrom', () => {
  it('reads no limits from an empty Delivery section, so every value is only reported', () => {
    const limits = deliveryLimitsFrom([field('integrated_lufs_min', ''), field('true_peak_dbtp_max', '')]);
    expect(setLimitCount(limits)).toBe(0);
    expect(limits.integrated_lufs).toEqual({});
  });

  it('reads each metric bound from its effective value, and ignores keys it does not know', () => {
    const limits = deliveryLimitsFrom([
      field('integrated_lufs_min', '-23'),
      field('integrated_lufs_max', '-18'),
      field('true_peak_dbtp_max', '-3'),
      field('clipping_ceiling', '-0.1'),
    ]);
    expect(limits.integrated_lufs).toEqual({ min: -23, max: -18 });
    expect(limits.true_peak_dbtp).toEqual({ max: -3 });
    expect(setLimitCount(limits)).toBe(3);
  });

  it('drops a value that is not a finite number instead of inventing a limit', () => {
    const limits = deliveryLimitsFrom([field('rms_dbfs_min', 'loud'), field('rms_dbfs_max', 'Infinity')]);
    expect(limits.rms_dbfs).toEqual({});
  });
});

// The same rules as measure.Evaluate (apps/desktop/internal/measure/profile.go): the bounds are inclusive, a value above the
// highest is checked before one below the lowest, and a value that could not be measured is never a pass.
describe('judge', () => {
  it('reports a value with no limit without checking it', () => {
    expect(judge(-19.4, {})).toEqual({ kind: 'unchecked' });
  });

  it('passes a value on either bound, since the bounds are inclusive', () => {
    expect(judge(-23, { min: -23, max: -18 })).toEqual({ kind: 'within' });
    expect(judge(-18, { min: -23, max: -18 })).toEqual({ kind: 'within' });
  });

  it('marks a value above the highest or below the lowest with the limit it broke', () => {
    expect(judge(-2.5, { max: -3 })).toEqual({ kind: 'above', limit: -3 });
    expect(judge(-25, { min: -23, max: -18 })).toEqual({ kind: 'below', limit: -23 });
  });

  it('never counts a value that could not be measured as within a limit', () => {
    expect(judge(null, { max: -3 })).toEqual({ kind: 'unavailable' });
    expect(judge(null, {})).toEqual({ kind: 'unavailable' });
  });
});

describe('formatting', () => {
  it('writes a level with one decimal and a real minus sign', () => {
    expect(formatLevel(-19.44)).toBe('−19.4');
    expect(formatLevel(0)).toBe('0.0');
  });

  it('writes a length as minutes and seconds, or hours when it is that long', () => {
    expect(formatLength(2)).toBe('0:02');
    expect(formatLength(1843.5)).toBe('30:43');
    expect(formatLength(3725)).toBe('1:02:05');
  });

  it('names every metric the report carries, with its unit', () => {
    expect(DELIVERY_METRICS.map((metric) => `${metric.key} ${metric.unit}`)).toEqual([
      'integrated_lufs LUFS',
      'rms_dbfs dBFS',
      'sample_peak_dbfs dBFS',
      'true_peak_dbtp dBTP',
      'noise_floor_dbfs dBFS',
    ]);
  });
});
