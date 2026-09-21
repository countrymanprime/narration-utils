import type { ReactNode } from 'react';

// The page (or section) title. `level` changes the tag only, so the outline is right where a heading sits under another
// one; the look is the same at every level (a caller that needs a different size adds a `size` prop when it has a case).
export function Heading({ title, level = 1, children }: { title: string; level?: 1 | 2 | 3; children?: ReactNode }) {
  const Tag = `h${level}` as const;
  return (
    <>
      <Tag className="font-['Barlow_Condensed',sans-serif] text-2xl leading-[1.05] font-semibold text-balance">{title}</Tag>
      {children && (
        // A path or file name has no break opportunity, so it wraps anywhere rather than pushing the page sideways.
        <p className="mt-1 text-sm [overflow-wrap:anywhere]" style={{ color: 'var(--text-muted)' }}>
          {children}
        </p>
      )}
    </>
  );
}
