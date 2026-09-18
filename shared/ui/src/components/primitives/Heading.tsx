import type { ReactNode } from 'react';

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="text-balance font-['Barlow_Condensed',sans-serif] text-2xl font-semibold leading-[1.05]">{title}</h1>
      {children && (
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {children}
        </p>
      )}
    </>
  );
}
