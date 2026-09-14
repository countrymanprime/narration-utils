import type { ReactNode } from 'react';

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="page-heading">{title}</h1>
      {children && (
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {children}
        </p>
      )}
    </>
  );
}
