// A measured file's verdict and why (stage-navigation-and-page-replacement.prd.md Phase 8, mock 05's "PASS / FAIL" column and
// "Why it fails"). The verdict reads only the host's own judgement of the file (MeasureFileResult.rules, ADR 0179): a file fails
// when any rule is not met; it has no verdict when a value it should have could not be measured (a silent render) or nothing was
// judged at all; it passes otherwise. A rule the app does not check is never counted as met; the row says how many are left.
import type { DeliveryProfile, DeliveryRule, DeliveryRuleResult, MeasureFileResult } from '../../types';
import { describeMiss, formatRuleValue } from './deliveryProfile';

export type FileVerdict = 'pass' | 'fail' | 'none';

export function fileVerdict(file: MeasureFileResult): FileVerdict {
  if (file.status !== 'measured') return 'none';
  if (file.rules.some((result) => result.status === 'not_met')) return 'fail';
  if (file.rules.some((result) => result.status === 'not_measurable')) return 'none';
  return file.rules.some((result) => result.status === 'met') ? 'pass' : 'none';
}

/** How many of a file's rules the app did not judge for it (not checked by the app, or not measurable): left to the narrator. */
export const leftToCheck = (file: MeasureFileResult): number =>
  file.rules.filter((result) => result.status === 'not_checked' || result.status === 'not_measurable').length;

/** A rule's value with its unit, as a sentence writes it: "−57.8 dBFS", "48 kHz", "2:04:10". */
function valueWithUnit(rule: DeliveryRule, value: number): string {
  const text = formatRuleValue(rule, value);
  return rule.unit && rule.metric !== 'duration_seconds' && rule.metric !== 'sample_rate' ? `${text} ${rule.unit}` : text;
}

/**
 * What the narrator can do about a missed rule, by what it measures. Only the built-in chain's own reach is promised: it sets RMS
 * and holds peaks (internal/mastering, ADR 0321), and it never lowers a noise floor or changes a format, so those say where to fix
 * them instead.
 */
export function suggestedFix(rule: DeliveryRule, result: DeliveryRuleResult): string | undefined {
  switch (rule.metric) {
    case 'rms_dbfs':
      return 'Master it to spec: the chain’s gain brings RMS into the window, then re-check.';
    case 'sample_peak_dbfs':
    case 'true_peak_dbtp':
      return 'Master it to spec: the limiter holds peaks under the limit, then re-check.';
    case 'noise_floor_dbfs':
      return 'Mastering does not lower the noise floor. Clean up the room tone in your DAW (a denoise pass, or a quieter take), render it again and re-check.';
    case 'sample_rate':
      return rule.oneOf.length > 0
        ? `Render it again at ${formatRuleValue(rule, rule.oneOf[0])}, then re-check.`
        : 'Render it again at the required sample rate.';
    case 'duration_seconds':
      return result.violation === 'above_max' ? 'Split it into shorter files at a section break, then re-check each.' : undefined;
    case 'head_room_tone_seconds':
    case 'tail_room_tone_seconds':
      return result.violation === 'below_min' ? 'Pad it with room tone from this file, then re-check.' : 'Trim the silence at that end, then re-check.';
    case 'channels':
      return 'Render every file with the same channels (mono, as a rule), then re-check.';
  }
  return undefined;
}

export type Miss = { rule: DeliveryRule; result: DeliveryRuleResult; text: string; fix?: string };

/** Each rule a file did not meet, in the profile's order, in a sentence with a suggested fix: "Sample rate 48 kHz: not 44.1 kHz." */
export function misses(file: MeasureFileResult, profile: DeliveryProfile): Miss[] {
  const owner = profile.builtIn ? `${profile.platform}'s` : 'the profile’s';
  return file.rules.flatMap((result) => {
    if (result.status !== 'not_met') return [];
    const rule = profile.rules.find((candidate) => candidate.id === result.ruleId);
    if (!rule) return [];
    const value = result.value !== null ? ` ${valueWithUnit(rule, result.value)}` : '';
    const fix = suggestedFix(rule, result);
    return [{ rule, result, text: `${rule.label}${value}: ${describeMiss(rule, result, owner)}.`, ...(fix ? { fix } : {}) }];
  });
}
