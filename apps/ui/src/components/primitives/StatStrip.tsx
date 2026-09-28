import { StatTile, type StatTileTone } from './StatTile';

export type StatStripItem = {
  key: string;
  label: string;
  value: string;
  hint?: string;
  unit?: string;
  /** 0 to 1. When given, a thin ok-toned ProgressBar is drawn under the value (StatTile's own default). */
  progress?: number;
  tone?: StatTileTone;
};

/**
 * The benchmark's one-card KPI row (mock-fidelity-primitives-and-components.prd.md Phase 9, mock B01): Production's six
 * figures used to sit in six separate cards (`ProductionPage.tsx`'s `Figures`, one `<li>` per tile, each its own bordered
 * surface); the mock draws one card, its tiles divided by a 1 px `--border` rule instead. `StatStrip` is that one card:
 * a labelled list of `StatTile`s, ≈195 px each with 16 px padding, whichever consumer supplies the figures.
 */
export function StatStrip({ items, label = 'Figures', className = '' }: { items: readonly StatStripItem[]; label?: string; className?: string }) {
  return (
    // Stacked with horizontal rules below a `sm` breakpoint (narrow layouts have no room for six ≈195 px tiles in a
    // row); Tailwind's `divide-x` marks every non-first child, so switching orientation at the same breakpoint avoids
    // a stray leading rule where a wrapped row would otherwise start.
    <ul
      aria-label={label}
      className={`flex flex-col divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] sm:flex-row sm:divide-x sm:divide-y-0 ${className}`}
    >
      {items.map(({ key, ...tile }) => (
        <li key={key} className="min-w-0 flex-1 p-4 sm:min-w-[12.1875rem]">
          <StatTile {...tile} />
        </li>
      ))}
    </ul>
  );
}
