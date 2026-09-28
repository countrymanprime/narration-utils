import type { AriaRole, ReactNode } from 'react';

// A card inside a card (ADR 0640): a 1 px frame at a 6 px radius with 12 px inside it, on the panel it sits in. `tone`
// colours the frame for a problem or a match, `fill` sets it on `--surface-2` to lift it off its panel, and `dashed`
// marks a placeholder (something that is not there yet). It replaces the hand-drawn `rounded-md border px-3 py-2` copies.
type InsetCardTone = 'neutral' | 'accent' | 'warn' | 'danger';

const TONE_BORDER: Record<InsetCardTone, string> = {
  neutral: 'var(--border)',
  accent: 'var(--accent)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
};

type InsetCardElement = 'div' | 'section' | 'li' | 'p';

export function InsetCard({
  as: Tag = 'div',
  tone = 'neutral',
  fill = false,
  dashed = false,
  role,
  id,
  className = '',
  children,
  ...aria
}: {
  as?: InsetCardElement;
  tone?: InsetCardTone;
  fill?: boolean;
  dashed?: boolean;
  role?: AriaRole;
  id?: string;
  // Layout only (margin, flex, gap): the look is the card's own.
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  return (
    <Tag
      id={id}
      role={role}
      {...aria}
      className={`rounded-md border p-3 ${dashed ? 'border-dashed' : ''} ${className}`}
      style={{ borderColor: TONE_BORDER[tone], background: fill ? 'var(--surface-2)' : undefined }}
    >
      {children}
    </Tag>
  );
}
