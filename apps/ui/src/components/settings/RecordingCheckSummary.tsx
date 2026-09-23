import type { Scope, ScopedSettingField } from '../../types';

// What the recording check's settings amount to (docs/utilities/recording-coverage.md Q3, ADR 0131). The values are
// chosen on synthetic fixtures (ADR 0132) and stay Proposed and uncalibrated on real narration (Q15), and the page says so. The two
// thresholds only change how a stored check is judged; the two alignment settings change which words count, so the host
// reads earlier checks as out of date once one changes (Q13).

const effective = (fields: readonly ScopedSettingField[], key: string) => fields.find((field) => field.key === key)?.effectiveValue ?? '';

function share(text: string): string {
  const value = Number(text);
  return text === '' || !Number.isFinite(value) ? '(not set)' : `${Math.round(value * 1000) / 10}%`;
}

function wordRun(text: string): string {
  const value = Number(text);
  if (text === '' || !Number.isFinite(value)) return '(not set) words';
  return `${value} ${value === 1 ? 'word' : 'words'}`;
}

/** The rule the effective thresholds make, in one sentence. */
export function recordingRule(fields: readonly ScopedSettingField[]): string {
  const present = share(effective(fields, 'min_paragraph_present'));
  const run = wordRun(effective(fields, 'max_missing_run'));
  return `A chapter counts as recorded when each paragraph has at least ${present} of its words read and no more than ${run} in a row are missing.`;
}

export function RecordingCheckSummary({ fields, scope }: { fields: readonly ScopedSettingField[]; scope: Scope }) {
  return (
    <div className="mb-4 space-y-1 rounded-md p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
      <div className="font-medium">Proposed values, not yet calibrated</div>
      <div>{recordingRule(fields)} Misreads, extra words and a spoken title never count against it.</div>
      <div style={{ color: 'var(--text-muted)' }}>
        These values were chosen on synthetic test recordings and have not been checked against real recordings yet. Changing the first two only changes how a
        stored check is judged; changing either of the last two makes earlier checks out of date, so check those chapters again.{' '}
        {scope === 'project' ? 'A value left blank here uses the Global one.' : ''}
      </div>
    </div>
  );
}
