// The Delivery page's reading of the narrator's own limits (the layered settings' Delivery section, ADR 0155), for the
// limits summary, and of how a measured value stands against them. The host judges (measure.Evaluate, diagnostics PRD
// Phase 7): every answer of the measurement carries each file's delivery_qc findings against the limits as they are when it
// is read, so changing one in Settings re-judges what is on screen without measuring again, and an exported report carries
// the same findings with the same IDs. The page only reads which value a finding is about and the limit it broke.
import { deliveryQcEvidenceSchema } from '../../api/schemas/measure';
import type { Finding, ScopedSettingField } from '../../types';

type DeliveryMetricKey = 'integrated_lufs' | 'rms_dbfs' | 'sample_peak_dbfs' | 'true_peak_dbtp' | 'noise_floor_dbfs';

export type DeliveryMetric = { key: DeliveryMetricKey; label: string; unit: string };

/** The measurements a limit can apply to, in the order the table shows them; `key` is also the report field. */
export const DELIVERY_METRICS: readonly DeliveryMetric[] = [
  { key: 'integrated_lufs', label: 'Loudness', unit: 'LUFS' },
  { key: 'rms_dbfs', label: 'RMS', unit: 'dBFS' },
  { key: 'sample_peak_dbfs', label: 'Sample peak', unit: 'dBFS' },
  { key: 'true_peak_dbtp', label: 'True peak', unit: 'dBTP' },
  { key: 'noise_floor_dbfs', label: 'Noise floor', unit: 'dBFS' },
];

/** One metric's bounds; a missing bound is no limit. */
export type MetricLimit = { min?: number; max?: number };
export type DeliveryLimits = Record<DeliveryMetricKey, MetricLimit>;

/** How one value stands: no finding about it, not measurable, or outside a limit (with the limit it broke). */
export type Judgement = { kind: 'reported' } | { kind: 'unavailable' } | { kind: 'above' | 'below'; limit: number };

const parse = (text: string): number | undefined => {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
};

/**
 * The limits in force, from the Delivery section's effective values (`<metric>_min` / `<metric>_max`). A blank value is no
 * limit; one that is not a finite number is dropped rather than guessed at (the host refuses to save one, so only a
 * hand-edited file can hold it).
 */
export function deliveryLimitsFrom(fields: readonly ScopedSettingField[]): DeliveryLimits {
  const value = (key: string) => parse(fields.find((field) => field.key === key)?.effectiveValue ?? '');
  const limitOf = (metric: DeliveryMetricKey): MetricLimit => {
    const min = value(`${metric}_min`);
    const max = value(`${metric}_max`);
    return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  };
  return {
    integrated_lufs: limitOf('integrated_lufs'),
    rms_dbfs: limitOf('rms_dbfs'),
    sample_peak_dbfs: limitOf('sample_peak_dbfs'),
    true_peak_dbtp: limitOf('true_peak_dbtp'),
    noise_floor_dbfs: limitOf('noise_floor_dbfs'),
  };
}

export function setLimitCount(limits: DeliveryLimits): number {
  return DELIVERY_METRICS.reduce((count, { key }) => count + (limits[key].min !== undefined ? 1 : 0) + (limits[key].max !== undefined ? 1 : 0), 0);
}

/**
 * How a value stands, from the host's findings for its file: a value that could not be measured is never a pass, and one
 * the host found outside a limit is marked with that limit. A finding whose evidence does not read as a delivery_qc
 * finding is left out rather than guessed at.
 */
export function judge(value: number | null, metric: DeliveryMetricKey, findings: readonly Finding[]): Judgement {
  if (value === null || !Number.isFinite(value)) return { kind: 'unavailable' };
  for (const finding of findings) {
    if (finding.category !== 'delivery_qc') continue;
    const evidence = deliveryQcEvidenceSchema.safeParse(finding.evidence);
    if (!evidence.success || evidence.data.metric !== metric) continue;
    const { violation, limit_max: max, limit_min: min } = evidence.data;
    if (violation === 'above_max' && max !== undefined) return { kind: 'above', limit: max };
    if (violation === 'below_min' && min !== undefined) return { kind: 'below', limit: min };
  }
  return { kind: 'reported' };
}

/** A level as the page writes it: one decimal, with a typographic minus so a column of negatives reads cleanly. */
export function formatLevel(value: number): string {
  return value.toFixed(1).replace('-', '−');
}

/** A duration as m:ss, or h:mm:ss from an hour up. */
export function formatLength(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = (whole % 60).toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes.toString().padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
