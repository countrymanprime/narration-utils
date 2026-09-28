// How the Review page words a delivery finding (delivery-platform-profiles.prd.md Phase 9): the rule a measured file missed,
// what was measured and how it missed, from the evidence the host saves with it (deliveryprofile.ReviewFindings). The Review
// page has no profile to look the rule up in, so the host names the rule, its requirement and the profile in the evidence.
import { deliveryQcEvidenceSchema } from '../../api/schemas/measure';
import type { Finding } from '../../types';
import { formatLength } from '../master/deliveryFormat';
import { formatRuleValue } from '../master/deliveryProfile';

type DeliveryEvidence = ReturnType<typeof deliveryQcEvidenceSchema.parse>;

/** A delivery finding's evidence, checked, or nothing for any other finding (or evidence this page cannot read). */
export function deliveryEvidence(finding: Finding): DeliveryEvidence | undefined {
  if (finding.category !== 'delivery_qc') return undefined;
  const parsed = deliveryQcEvidenceSchema.safeParse(finding.evidence);
  return parsed.success ? parsed.data : undefined;
}

/** The file a delivery finding is about, by its name. */
export const deliveryFileName = (finding: Finding): string | undefined => finding.source.file?.split(/[\\/]/).pop() || undefined;

/** A number as a bound is written: at most two decimals, a typographic minus; a length as h:mm:ss; a rate in kHz. */
function bound(evidence: DeliveryEvidence, value: number): string {
  if (evidence.metric === 'duration_seconds') return formatLength(value);
  if (evidence.metric === 'sample_rate') return formatRuleValue({ metric: evidence.metric, unit: evidence.unit ?? '' }, value);
  return String(Number(value.toFixed(2))).replace('-', '−');
}

/** The measured value in the rule's own unit: "−24.1 dBFS", "48 kHz", "1:02:03", "176 kbps". */
function measured(evidence: DeliveryEvidence, value: number): string {
  const text = formatRuleValue({ metric: evidence.metric, unit: evidence.unit ?? '' }, value);
  const unitWritten = ['duration_seconds', 'sample_rate', 'channels'].includes(evidence.metric);
  return evidence.unit && !unitWritten ? `${text} ${evidence.unit}` : text;
}

const label = (evidence: DeliveryEvidence) => evidence.rule_label ?? evidence.rule;

/** "RMS −24.1 dBFS, below the minimum of −23", "Noise floor could not be measured". */
export function deliverySummary(evidence: DeliveryEvidence): string {
  if (evidence.value === undefined) return `${label(evidence)} could not be measured`;
  const value = `${label(evidence)} ${measured(evidence, evidence.value)}`;
  switch (evidence.violation) {
    case 'below_min':
      return evidence.limit_min === undefined ? `${value}, below the minimum` : `${value}, below the minimum of ${bound(evidence, evidence.limit_min)}`;
    case 'above_max':
      return evidence.limit_max === undefined ? `${value}, above the maximum` : `${value}, above the maximum of ${bound(evidence, evidence.limit_max)}`;
    case 'not_one_of':
      return `${value}, not ${(evidence.allowed ?? []).map((allowed) => bound(evidence, allowed)).join(' or ')}`;
    case 'not_cbr':
      return `${value}, not a constant bit rate`;
  }
  return value;
}

/** The evidence rows: the rule, the requirement it enforces, what was measured, and the profile that judged it. */
export function deliveryEvidenceRows(evidence: DeliveryEvidence): Array<{ label: string; value: string }> {
  return [
    { label: 'Rule', value: label(evidence) },
    ...(evidence.requirement ? [{ label: 'Requirement', value: evidence.requirement }] : []),
    { label: 'Measured', value: evidence.value === undefined ? 'Could not be measured' : measured(evidence, evidence.value) },
    { label: 'Judged against', value: evidence.profile_name ?? evidence.profile },
  ];
}
