import type { ReactNode } from 'react';
import { Dot } from './StatusBadge';

/**
 * What a header chip says about its subject: `neutral` for a readout (the running timer, the series, an engine that needs
 * nothing), `success` for a live link (REAPER linked), `warning` for one that needs the narrator (the wrong project open).
 */
export type HeaderChipTone = 'neutral' | 'success' | 'warning';

// The fill and text per tone, the benchmark mocks' own (mock 01's header, mock-fidelity-primitives-and-components.prd.md
// Phase 8): the timer on `--surface-2` in `--text`, "REAPER linked" on `--ok-soft` in `--ok-text`. Each pair is one the
// palette guard already checks (ADR 0590).
const TONE: Record<HeaderChipTone, { background: string; color: string }> = {
  neutral: { background: 'var(--surface-2)', color: 'var(--text)' },
  success: { background: 'var(--ok-soft)', color: 'var(--ok-text)' },
  warning: { background: 'var(--warn-soft)', color: 'var(--warn-text)' },
};

// Measured on mock 01 at 1440 px: 22 px tall, fully rounded, no border, 10 px each side, its parts 6 px apart, Barlow
// Condensed 600 at 11.5 px in the label's own case. Below `md` the chip's side padding shrinks with its text (see `short`).
const CHIP =
  "inline-flex h-[1.375rem] items-center gap-[0.375rem] rounded-full px-[0.625rem] font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.03em] whitespace-nowrap";

/**
 * The header's chip (ADR 0635): the running timer, the audio engine and the Booth's built-in recorder are one shape. A
 * `dot` draws the status dot in that colour ahead of the content; `onClick` makes the chip a button (the engine chip opens
 * the engine panel). `short` is for a chip whose text hides below `md` (it keeps its dot or clock): its padding tightens
 * with it. The accessible name, when the visible text is not the whole of it, comes from `aria-label`.
 */
export function HeaderChip({
  tone = 'neutral',
  dot,
  children,
  onClick,
  short = false,
  role,
  'aria-label': ariaLabel,
  'aria-busy': ariaBusy,
  className = '',
}: {
  tone?: HeaderChipTone;
  /** The status dot's colour (a token), drawn before the content. */
  dot?: string;
  children?: ReactNode;
  onClick?: () => void;
  short?: boolean;
  /** `group` for a named chip that is not a button; `timer` for the running clock (never a live region). */
  role?: 'group' | 'timer';
  'aria-label'?: string;
  'aria-busy'?: boolean;
  /** Placement only (`flex-none`, or `min-w-0` for a chip that truncates): the look is the chip's. */
  className?: string;
}) {
  const classes = `${CHIP} ${short ? 'max-md:px-[0.375rem]' : ''} ${className}`.replace(/\s+/g, ' ').trim();
  const content = (
    <>
      {dot && <Dot color={dot} />}
      {children}
    </>
  );
  if (onClick)
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-busy={ariaBusy || undefined}
        className={`${classes} cursor-pointer outline-offset-2 hover:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-60`}
        style={TONE[tone]}
      >
        {content}
      </button>
    );
  return (
    <span role={role} aria-label={ariaLabel} aria-busy={ariaBusy || undefined} className={classes} style={TONE[tone]}>
      {content}
    </span>
  );
}
