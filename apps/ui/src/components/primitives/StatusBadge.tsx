import type { ReactNode } from 'react';

// A closed set of meanings, not one tone per stage name (studio-ui-primitives.prd.md Q6, ADR 0360): stage names change,
// meanings do not, so a caller maps its own status onto one of these (see src/chapterStatus.ts's STATUS_TONE).
export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger' | 'experimental';

// `fill`/`text` are Phase 1's badge tokens where one exists (success/warning/danger/info/experimental); `neutral` and
// `progress` reuse already-declared, already-passing pairs instead of a sixth and seventh badge-fill token
// (paletteContrast.test.ts: `text-muted` on `surface-2`, `accent-strong-on-soft`) since Phase 1 only budgeted a tint for
// the four existing status tones plus `experimental`. `text` is also the dot's mark colour: it already clears 4.5:1,
// which clears the 3:1 a mark needs, so the dot needs no colour of its own.
const TONE_STYLE: Record<StatusTone, { fill: string; text: string }> = {
  neutral: { fill: 'var(--surface-2)', text: 'var(--text-muted)' },
  info: { fill: 'var(--badge-info-fill)', text: 'var(--info-text)' },
  progress: { fill: 'var(--accent-soft)', text: 'var(--accent-strong)' },
  success: { fill: 'var(--badge-ok-fill)', text: 'var(--ok-text)' },
  warning: { fill: 'var(--badge-warn-fill)', text: 'var(--warn-text)' },
  danger: { fill: 'var(--badge-danger-fill)', text: 'var(--danger-text)' },
  experimental: { fill: 'var(--badge-experimental-fill)', text: 'var(--experimental-text)' },
};

const CHIP_CLASS =
  "inline-flex items-center gap-[0.35rem] rounded-full px-[0.55rem] py-[0.15rem] font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold uppercase tracking-[0.03em]";

export function StatusBadge({ tone, label, icon, variant = 'chip' }: { tone: StatusTone; label: string; icon?: ReactNode; variant?: 'chip' | 'dot' }) {
  const { fill, text } = TONE_STYLE[tone];

  // The dense-list dot (PRD "Could"): a mark, not text, so the label is its accessible name via `role="img"` rather than
  // visible content - a screen reader hears the label; a sighted user gets the colour only, by design.
  if (variant === 'dot') {
    return <span role="img" aria-label={label} className="inline-block size-2 flex-none rounded-full" style={{ background: text }} />;
  }

  return (
    <span className={CHIP_CLASS} style={{ background: fill, color: text }}>
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
    </span>
  );
}
