// Accessibility rules a story is KNOWN to violate, each with the reason and where the fix belongs.
// This is an escape hatch, not a default: an entry hides a real failure, so it needs a reason,
// the list may only shrink (see src/atlasCoverage.test.ts), and a story may only be listed
// for the rules named here - anything else it violates still fails.
export interface A11yDebt {
  // Story title (e.g. 'Primitives/WorkDialog'); matches every story of that component.
  title: string;
  rules: string[];
  reason: string;
}

const HIGHLIGHT_CONTRAST =
  'Category colours (--character, --place, ...) used as text on a 20% tint of themselves reach only 3.2-3.8:1. Fixing it changes the highlight design (ADR-0016) - a design decision, tracked separately.';

const ACCENT_ON_TINT =
  'Active nav item is --accent text on a 10% accent tint: 4.03:1 in the light theme. Fixing it means a darker accent for text (--accent-strong), a design decision, tracked separately.';

export const A11Y_DEBT: A11yDebt[] = [
  { title: 'Primitives/NavButton', rules: ['color-contrast'], reason: ACCENT_ON_TINT },
  { title: 'Primitives/Highlight', rules: ['color-contrast'], reason: HIGHLIGHT_CONTRAST },
];

export function allowedRules(title: string): string[] {
  return A11Y_DEBT.filter((debt) => debt.title === title).flatMap((debt) => debt.rules);
}
