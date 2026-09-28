import type { ReactNode } from 'react';

// The eyebrow label the mocks put over a section, a KPI tile and a nav group (ADR 0640): Barlow Condensed at the label
// size (11 px), semibold, uppercase, tracked 0.1 em, muted. It replaces the copies of that class string and the global
// `.section-label` (which now draws the same thing for the files that still use it). `as` picks the element, so a label
// that names a region is a heading and one over a fieldset is its legend; the look is the same on every element.
export const SECTION_LABEL_CLASS =
  "font-['Barlow_Condensed',sans-serif] text-[length:var(--font-size-label)] font-semibold tracking-[var(--tracking-label)] text-[var(--text-muted)] uppercase";

type SectionLabelElement = 'span' | 'div' | 'p' | 'h2' | 'h3' | 'legend';

export function SectionLabel({
  as: Tag = 'span',
  id,
  className = '',
  children,
}: {
  as?: SectionLabelElement;
  id?: string;
  // Layout only (margin, display): the look is the label's own.
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag id={id} className={`${SECTION_LABEL_CLASS} ${className}`}>
      {children}
    </Tag>
  );
}
