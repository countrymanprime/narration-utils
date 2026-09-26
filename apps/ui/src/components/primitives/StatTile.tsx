import { ProgressBar } from './ProgressBar';

const EYEBROW = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";
const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";

const TONE_TEXT: Record<Exclude<StatTileTone, 'neutral'>, string> = {
  info: 'var(--info-text)',
  success: 'var(--ok-text)',
  warning: 'var(--warn-text)',
  danger: 'var(--danger-text)',
  experimental: 'var(--experimental-text)',
};

export type StatTileTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'experimental';

// One KPI figure: an eyebrow label, a mono value, and an optional hint line under it (promoted from the local copy in
// home/RecordingCheckReport.tsx). `unit` sits beside the value in the label's muted style rather than baked into the
// value string, so a caller that colours the value by `tone` doesn't also tint its unit. `progress` (0-1) draws the
// existing ProgressBar under the value, named after the tile's own label.
export function StatTile({
  label,
  value,
  hint,
  unit,
  progress,
  tone = 'neutral',
  className = '',
}: {
  label: string;
  value: string;
  hint?: string;
  unit?: string;
  /** 0 to 1. When given, a ProgressBar is drawn under the value, named after `label`. */
  progress?: number;
  tone?: StatTileTone;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className={EYEBROW}>{label}</div>
      <div className={`mt-0.5 text-xl font-semibold ${MONO}`}>
        <span style={tone === 'neutral' ? undefined : { color: TONE_TEXT[tone] }}>{value}</span>
        {unit && (
          <span className={`ml-1 text-sm font-normal ${MONO}`} style={{ color: 'var(--text-muted)' }}>
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      )}
      {progress !== undefined && (
        <div className="mt-1.5">
          <ProgressBar label={label} value={Math.round(progress * 100)} />
        </div>
      )}
    </div>
  );
}
