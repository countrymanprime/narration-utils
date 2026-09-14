import type { ReactNode } from 'react';

export function Panel({ children }: { children: ReactNode }) {
  return <section className="panel panel-body">{children}</section>;
}
