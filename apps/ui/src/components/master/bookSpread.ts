// The book-wide spread (docs/prds/delivery-platform-profiles.prd.md Phase 10, mockup 11 "Book consistency"): a per-rule
// min/max/median across every measured file's judged value, for the numeric per-file level rules only (RMS, peak, noise
// floor). A rule contributes a file's value only once the app has actually judged it (`met` or `not_met`): a `not_checked`
// row (an MP3's level before Phase 8 decodes it) or a `not_measurable` one (silence, a too-short file) is never counted, so
// the spread reads only real measurements and never a zero or a guess. Once Phase 8 measures MP3 levels, those files' rule
// results turn from `not_checked` to `met`/`not_met` like any other, and start contributing here with no change to this file.
import type { DeliveryProfile, DeliveryRule, MeasureFileResult } from '../../types';

/** The metrics this spread covers, in the order they are shown. */
const SPREAD_METRICS = ['rms_dbfs', 'sample_peak_dbfs', 'noise_floor_dbfs'];

export type BookSpreadStat = { min: number; max: number; median: number; count: number };

export type BookSpreadRow = { rule: DeliveryRule; values: number[]; stat?: BookSpreadStat };

/** The values a rule was actually judged against, across every file, ascending. */
function judgedValues(rule: DeliveryRule, files: readonly MeasureFileResult[]): number[] {
  return files
    .flatMap((file) => (file.status === 'measured' ? file.rules : []))
    .filter((result) => result.ruleId === rule.id && (result.status === 'met' || result.status === 'not_met') && result.value !== null)
    .map((result) => result.value as number)
    .sort((a, b) => a - b);
}

/** The min, max and median of a sorted, non-empty list of values. */
export function spreadStat(sortedValues: readonly number[]): BookSpreadStat | undefined {
  if (sortedValues.length === 0) return undefined;
  const mid = Math.floor(sortedValues.length / 2);
  const median = sortedValues.length % 2 === 0 ? (sortedValues[mid - 1] + sortedValues[mid]) / 2 : sortedValues[mid];
  return { min: sortedValues[0], max: sortedValues[sortedValues.length - 1], median, count: sortedValues.length };
}

/**
 * One row per numeric per-file level rule the profile carries and has not turned off, in the profile's own order.
 * `stat` is undefined when no file has a judged value yet, so the caller shows "No measurements yet" rather than a
 * zero or a guess.
 */
export function bookSpreadRows(profile: DeliveryProfile, files: readonly MeasureFileResult[]): BookSpreadRow[] {
  return profile.rules
    .filter((rule) => rule.scope === 'file' && !rule.off && SPREAD_METRICS.includes(rule.metric))
    .map((rule) => {
      const values = judgedValues(rule, files);
      return { rule, values, stat: spreadStat(values) };
    });
}
