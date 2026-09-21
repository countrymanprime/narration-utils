import { useId, type ReactNode } from 'react';

// `actions` sit beside the title, so they need one.
type PanelProps = { children: ReactNode } & ({ title?: undefined; actions?: undefined } | { title: string; actions?: ReactNode });

// A surface for a group of content. With a `title` it is a named region: the title is a level-2 heading (a panel sits
// beneath the page's level-1 heading) and the section is labelled by it, so a screen reader can list and jump to it.
// Without one it stays the bare surface it always was.
export function Panel({ title, actions, children }: PanelProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-[1.1rem] shadow-[var(--shadow)]"
    >
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={titleId} className="min-w-0 font-semibold [overflow-wrap:anywhere]">
            {title}
          </h2>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
