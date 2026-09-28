import type { CSSProperties, ReactNode } from 'react';

// A closed set of meanings, not one tone per stage name (studio-ui-primitives.prd.md Q6, ADR 0360): stage names change,
// meanings do not, so a caller maps its own status onto one of these (see src/chapterStatus.ts's STATUS_TONE). `accent`
// (the proofer, a query, "Author ✓") and `org` (the Proof PACING tag) are the two the benchmark mocks add
// (mock-fidelity-primitives-and-components.prd.md Phase 2, ADR 0600).
export type StatusTone = 'neutral' | 'info' | 'progress' | 'accent' | 'success' | 'warning' | 'danger' | 'org' | 'experimental';

/**
 * The one badge shape (ADR 0600), measured on the benchmark mocks at 1440 px:
 * - `pill`: the status pill (a resolution, a summary, "On track", a filter). 22 px tall, fully rounded, 10 px each side,
 *   Barlow Condensed 600 at 11.5 px in the label's own case: the mocks write "Pickup", "6 need pickup", "Query sent".
 * - `tag`: the type badge (Proof's MISREAD, the Script's speaker, "Retail sample"). 16 px tall, the 3 px tag radius, 6 px
 *   each side, Barlow Condensed 600 at the 11 px label size in capitals.
 * - `booth`: the Booth's speaker tag beside the script (mock 03). A tag at 26 px, radius 4, 8 px each side.
 * - `cell`: a Production board cell (mock 01, ADR 0645). A flat 20 px block at least 58 px wide, on the tag radius, its
 *   label centred in Barlow Condensed 600 at the 11 px label size in its own case ("✓", "3 open", "PASS"), so every cell
 *   of a column lines up whatever it says. A label longer than the cell is clipped inside it: a board's caller keeps its
 *   labels short.
 */
export type BadgeShape = 'pill' | 'tag' | 'booth' | 'cell';

/** `soft` fills the badge with its tone's soft fill; `outline` draws it hollow in the tone's line colour, the dark sets'
 * "TO VERIFY" and "CHANGED" badges (and the Keyboard panel's "Changed", which the input-commands mock draws the same). */
export type BadgeLook = 'soft' | 'outline';

/** A badge's colours: `fill` behind the label, `text` for it (and a dot's mark), `line` for the outline look. */
export type BadgeColors = { fill: string; text: string; line: string };

// Each fill is the Phase 0b soft token (ADR 0590, Q3), opaque and checked against its `-text` by paletteContrast.test.ts;
// `neutral` and `progress`/`accent` reuse pairs that were already checked (`text-muted` on `surface-2`,
// `accent-strong-on-soft`). `experimental` has no soft token, so it keeps ADR 0362's tint.
const TONE_STYLE: Record<StatusTone, BadgeColors> = {
  neutral: { fill: 'var(--surface-2)', text: 'var(--text-muted)', line: 'var(--border)' },
  info: { fill: 'var(--info-soft)', text: 'var(--info-text)', line: 'var(--info)' },
  progress: { fill: 'var(--accent-soft)', text: 'var(--accent-strong)', line: 'var(--accent)' },
  accent: { fill: 'var(--accent-soft)', text: 'var(--accent-strong)', line: 'var(--accent)' },
  success: { fill: 'var(--ok-soft)', text: 'var(--ok-text)', line: 'var(--ok)' },
  warning: { fill: 'var(--warn-soft)', text: 'var(--warn-text)', line: 'var(--warn)' },
  danger: { fill: 'var(--danger-soft)', text: 'var(--danger-text)', line: 'var(--danger)' },
  org: { fill: 'var(--org-soft)', text: 'var(--org-text)', line: 'var(--org)' },
  experimental: { fill: 'var(--badge-experimental-fill)', text: 'var(--experimental-text)', line: 'var(--experimental)' },
};

/** The colours a tone draws with, for a caller that draws the badge look on its own element (a Menu trigger). */
export function toneColors(tone: StatusTone): BadgeColors {
  return TONE_STYLE[tone];
}

// Every shape carries a 1 px border, transparent in the soft look, so an outline badge is the same size as a soft one; the
// side padding is the measured one less that border. `min-h` rather than `h`: a long label wraps instead of pushing the
// row sideways at a narrow width, unless its caller keeps it on one line (`whitespace-nowrap` on a wrapper, as Proof's
// table does), which the badge inherits.
const BASE = "inline-flex max-w-full items-center border border-solid font-['Barlow_Condensed',sans-serif] font-semibold leading-[1.1]";
const SHAPE_CLASS: Record<BadgeShape, string> = {
  pill: 'min-h-[1.375rem] gap-[0.35rem] rounded-full px-[0.5625rem] py-[0.1rem] text-[0.72rem] tracking-[0.06em]',
  tag: 'min-h-4 gap-1 rounded-[var(--radius-tag)] px-[0.3125rem] py-0 text-[length:var(--font-size-label)] tracking-[0.06em] uppercase',
  booth: 'min-h-[1.625rem] gap-1 rounded-[0.25rem] px-[0.4375rem] py-[0.1rem] text-[0.75rem] tracking-[0.06em] uppercase',
  cell: 'h-5 min-w-[3.625rem] justify-center gap-1 overflow-hidden rounded-[var(--radius-tag)] px-1.5 py-0 text-[length:var(--font-size-label)] tracking-[0.04em] whitespace-nowrap',
};

/** The class list of a badge of `shape`, for an element that is not a `Badge` (a Menu trigger, a speaker tag button). */
export function badgeClass(shape: BadgeShape = 'pill'): string {
  return `${BASE} ${SHAPE_CLASS[shape]}`;
}

/** The inline colours of a badge in `look`. */
export function badgeStyle({ fill, text, line }: BadgeColors, look: BadgeLook = 'soft'): CSSProperties {
  return look === 'outline' ? { background: 'transparent', color: text, borderColor: line } : { background: fill, color: text, borderColor: 'transparent' };
}

type BadgeProps = {
  label: ReactNode;
  colors: BadgeColors;
  shape?: BadgeShape;
  look?: BadgeLook;
  icon?: ReactNode;
  /** Makes the badge a button (a summary chip that opens what it counts). */
  onClick?: () => void;
  /** Placement only (a margin): the look is the badge's. */
  className?: string;
};

/**
 * THE badge: every pill, tag and chip in the app is drawn by this (ADR 0600), in a status tone through `StatusBadge` or in
 * a caller's own colours (an entity kind, a speaker). A page never pastes the classes (badgeShapes.test.ts).
 */
export function Badge({ label, colors, shape = 'pill', look = 'soft', icon, onClick, className = '' }: BadgeProps) {
  const content = (
    <>
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
    </>
  );
  const classes = `${badgeClass(shape)} ${className}`.trim();
  if (onClick)
    return (
      <button
        type="button"
        className={`${classes} cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
        style={badgeStyle(colors, look)}
        onClick={onClick}
      >
        {content}
      </button>
    );
  return (
    <span className={classes} style={badgeStyle(colors, look)}>
      {content}
    </span>
  );
}

/**
 * The status dot: a 8 px circle in a colour (the mocks draw 7-8 px). With a `label` it is a mark a screen reader names
 * (`role="img"`); without one it is decoration beside text that already says the same thing.
 */
export function Dot({ color, label, className = '' }: { color: string; label?: string; className?: string }) {
  const classes = `inline-block size-2 flex-none rounded-full ${className}`.trim();
  if (label) return <span role="img" aria-label={label} className={classes} style={{ background: color }} />;
  return <span aria-hidden="true" className={classes} style={{ background: color }} />;
}

export function StatusBadge({
  tone,
  label,
  icon,
  variant = 'chip',
  shape = 'pill',
  look = 'soft',
  onClick,
  className,
}: {
  tone: StatusTone;
  label: string;
  icon?: ReactNode;
  variant?: 'chip' | 'dot';
  shape?: BadgeShape;
  look?: BadgeLook;
  onClick?: () => void;
  className?: string;
}) {
  const colors = TONE_STYLE[tone];

  // The dense-list dot (PRD "Could"): a mark, not text, so the label is its accessible name via `role="img"` rather than
  // visible content - a screen reader hears the label; a sighted user gets the colour only, by design. `text` already
  // clears 4.5:1, which clears the 3:1 a mark needs, so the dot needs no colour of its own.
  if (variant === 'dot') return <Dot color={colors.text} label={label} className={className} />;

  return <Badge label={label} colors={colors} shape={shape} look={look} icon={icon} onClick={onClick} className={className} />;
}
