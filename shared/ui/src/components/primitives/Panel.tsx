import type { ReactNode } from 'react';

export function Panel({ children }: { children: ReactNode }) {
  return <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-[1.1rem] shadow-[var(--shadow)]">{children}</section>;
}
