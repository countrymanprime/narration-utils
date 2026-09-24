import { describe, expect, it } from 'vitest';
import type { Finding, ScopedSettingField } from '../../types';
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

// The host judges (measure.Evaluate, apps/desktop/internal/measure/profile.go) and sends each file's delivery_qc findings; the page
// only reads which value a finding is about and the limit it broke.
const qc = (evidence: Record<string, unknown>, category = 'delivery_qc'): Finding => ({
  schema_version: 1,
  id: `qc-${String(evidence.metric)}`,
  analyzer: 'measure',
  project: {},
  source: { file: 'C:/Renders/Chapter 01.wav' },
  category,
  severity: 'error',
  confidence: 1,
  confidence_reason: 'deterministic measurement of the decoded samples',
  evidence,
  review: { status: 'unreviewed' },
});

describe('judge', () => {
  it('reports a value the host raised no finding about', () => {
    expect(judge(-19.4, 'integrated_lufs', [])).toEqual({ kind: 'reported' });
    expect(judge(-19.4, 'integrated_lufs', [qc({ metric: 'true_peak_dbtp', violation: 'above_max', limit_max: -3 })])).toEqual({ kind: 'reported' });
  });

  it('marks a value the host found above the highest or below the lowest with the limit it broke', () => {
    expect(judge(-2.5, 'true_peak_dbtp', [qc({ metric: 'true_peak_dbtp', violation: 'above_max', limit_max: -3 })])).toEqual({ kind: 'above', limit: -3 });
    expect(judge(-25, 'integrated_lufs', [qc({ metric: 'integrated_lufs', violation: 'below_min', limit_min: -23, limit_max: -18 })])).toEqual({
      kind: 'below',
      limit: -23,
    });
  });

  it('never counts a value that could not be measured as within a limit', () => {
    expect(judge(null, 'true_peak_dbtp', [qc({ metric: 'true_peak_dbtp', available: false })])).toEqual({ kind: 'unavailable' });
    expect(judge(null, 'true_peak_dbtp', [])).toEqual({ kind: 'unavailable' });
  });

  it('leaves out a finding that is not a delivery_qc finding or whose evidence does not read as one', () => {
    expect(judge(-2.5, 'true_peak_dbtp', [qc({ metric: 'true_peak_dbtp', violation: 'above_max', limit_max: -3 }, 'audio_quality')])).toEqual({
      kind: 'reported',
    });
    expect(judge(-2.5, 'true_peak_dbtp', [qc({ metric: 'true_peak_dbtp', violation: 'louder' })])).toEqual({ kind: 'reported' });
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
