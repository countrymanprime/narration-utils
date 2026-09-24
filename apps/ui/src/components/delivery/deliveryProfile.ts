// The Delivery page's reading of a delivery profile (docs/prds/delivery-platform-profiles.prd.md, ADR 0179): how a profile is
// named, how a rule's bound and a measured value are written, and the words for a rule's result. The host judges
// (deliveryprofile.EvaluateFile, on every read of the measurement); the page only shows its results.
import type { DeliveryProfile, DeliveryRule, DeliveryRuleResult } from '../../types';
import { formatLength, formatLevel } from './deliveryFormat';

/** The key the host names a profile by: id@version for a built-in, id@r<revision> for a custom profile. */
export function deliveryProfileKey(profile: Pick<DeliveryProfile, 'id' | 'version' | 'revision' | 'builtIn'>): string {
  return profile.builtIn ? `${profile.id}@${profile.version}` : `${profile.id}@r${profile.revision}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** How the page names a profile: "ACX (September 2026)" for a built-in, a custom profile's own name. */
export function deliveryProfileTitle(profile: Pick<DeliveryProfile, 'name' | 'version' | 'builtIn'>): string {
  if (!profile.builtIn) return profile.name;
  const match = /^(\d{4})-(\d{2})$/.exec(profile.version);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${profile.name} (${month} ${match[1]})` : `${profile.name} (${profile.version})`;
}

/** What the page writes for "what ACX requires" or a custom profile's requirement. */
export function requirementOwner(profile: DeliveryProfile): string {
  return profile.builtIn ? `${profile.platform} requires` : 'Requirement';
}

const trim = (value: number) => String(Number(value.toFixed(2))).replace('-', '−');

/** A value in the rule's own unit, as a column shows it: levels to one decimal, a length as m:ss, a rate in kHz. */
export function formatRuleValue(rule: Pick<DeliveryRule, 'metric' | 'unit'>, value: number): string {
  switch (rule.metric) {
    case 'duration_seconds':
      return formatLength(value);
    case 'sample_rate':
      return `${trim(value / 1000)} kHz`;
    case 'channels':
      return value === 1 ? 'mono' : value === 2 ? 'stereo' : `${value} channels`;
  }
  return rule.unit === 'dBFS' || rule.unit === 'dBTP' || rule.unit === 'LUFS' ? formatLevel(value) : trim(value);
}

const boundNumber = (rule: Pick<DeliveryRule, 'metric' | 'unit'>, value: number) =>
  rule.metric === 'duration_seconds' ? `${trim(value / 60)} min` : trim(value);

/** A rule's bound in short: "−23 to −18 dBFS", "≤ −3 dBFS", "44.1 kHz", "≤ 120 min", "192 kbps+ CBR". */
export function formatBound(rule: DeliveryRule): string {
  if (rule.boundText) return rule.boundText;
  if (rule.oneOf.length > 0) {
    const values = rule.oneOf.map((value) => formatRuleValue(rule, value)).join(' or ');
    return rule.sameAcrossFiles ? `${values}, the same in every file` : values;
  }
  const unit = rule.metric === 'duration_seconds' ? '' : rule.unit ? ` ${rule.unit}` : '';
  if (rule.min !== null && rule.max !== null) return `${boundNumber(rule, rule.min)} to ${boundNumber(rule, rule.max)}${unit}`;
  if (rule.max !== null) return `≤ ${boundNumber(rule, rule.max)}${unit}`;
  if (rule.min !== null) return `≥ ${boundNumber(rule, rule.min)}${unit}`;
  return '';
}

/** How the app checks a rule, in words: "Measured: −23 to −18 dBFS", "Not checked by the app.", "Listen". */
export function describeCheck(rule: DeliveryRule): string {
  if (rule.off) return 'Off: not judged, listed as off in the report.';
  if (rule.checkedBy === 'listen') return 'Listen';
  if (rule.checkedBy === 'not_yet')
    return rule.id.endsWith('.format') ? 'Not checked by the app. The WAV is measured; check the MP3 you upload.' : 'Not checked by the app.';
  const bound = formatBound(rule);
  return bound ? `Measured: ${bound}` : 'Measured';
}

/** How a met value stands against the bound, in words: "within −23 to −18 dBFS", "at or below −3 dBFS", "44.1 kHz". */
export function describeMet(rule: DeliveryRule): string {
  if (rule.oneOf.length > 0 || rule.boundText) return formatBound(rule);
  const unit = rule.metric === 'duration_seconds' ? '' : rule.unit ? ` ${rule.unit}` : '';
  if (rule.min !== null && rule.max !== null) return `within ${boundNumber(rule, rule.min)} to ${boundNumber(rule, rule.max)}${unit}`;
  if (rule.max !== null)
    return rule.metric === 'duration_seconds' ? `under ${boundNumber(rule, rule.max)}` : `at or below ${boundNumber(rule, rule.max)}${unit}`;
  if (rule.min !== null) return `at or above ${boundNumber(rule, rule.min)}${unit}`;
  return '';
}

/** How a missed value missed, against whose bound: "below ACX's −23 minimum", "not 44.1 kHz". */
export function describeMiss(rule: DeliveryRule, result: DeliveryRuleResult, owner: string): string {
  switch (result.violation) {
    case 'below_min':
      return rule.min !== null ? `below ${owner} ${boundNumber(rule, rule.min)} minimum` : 'below the minimum';
    case 'above_max':
      return rule.max !== null ? `above ${owner} ${boundNumber(rule, rule.max)} maximum` : 'above the maximum';
    case 'not_one_of':
      return `not ${formatBound(rule)}`;
    case 'differs_across_files':
      return 'not the same in every file';
  }
  return '';
}

/** How many rules the app checks, does not check, and leaves to listening; how many are to verify or conflicting. */
export function profileCounts(profile: DeliveryProfile) {
  const on = profile.rules.filter((rule) => !rule.off);
  return {
    checked: on.filter((rule) => rule.checkedBy === 'measured').length,
    notChecked: on.filter((rule) => rule.checkedBy === 'not_yet').length,
    listen: on.filter((rule) => rule.checkedBy === 'listen').length,
    off: profile.rules.length - on.length,
    toVerify: profile.rules.filter((rule) => rule.verification === 'to_verify').length,
    conflicting: profile.rules.filter((rule) => rule.verification === 'conflicting').length,
  };
}
