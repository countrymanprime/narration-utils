import type { CSSProperties } from 'react';
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
 *
 * It wraps into full rows by the width its card has (ADR 0645): every tile in one row from 64 rem, half of them a row from
 * 36 rem, two from 22 rem, one below that. Each tile draws the rule on its left and top, and the card clips the ones on its
 * own edges, so a rule runs between every two tiles in any arrangement and a short last row leaves plain surface.
 */
export function StatStrip({ items, label = 'Figures', className = '' }: { items: readonly StatStripItem[]; label?: string; className?: string }) {
  const counts = { '--strip-all': items.length, '--strip-half': Math.ceil(items.length / 2) } as CSSProperties;
  return (
    <div
      className={`@container overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] ${className}`}
    >
      <ul
        aria-label={label}
        style={counts}
        className="-m-px grid grid-cols-[repeat(var(--strip-cols),minmax(0,1fr))] [--strip-cols:1] @min-[22rem]:[--strip-cols:2] @min-[36rem]:[--strip-cols:var(--strip-half)] @min-[64rem]:[--strip-cols:var(--strip-all)]"
      >
        {items.map(({ key, ...tile }) => (
          <li key={key} className="min-w-0 border-t border-l border-[var(--border)] px-4 pt-3.5 pb-3">
            <StatTile {...tile} />
          </li>
        ))}
      </ul>
    </div>
  );
}
