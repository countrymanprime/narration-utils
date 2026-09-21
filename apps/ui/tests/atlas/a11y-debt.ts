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

export const A11Y_DEBT: A11yDebt[] = [];

export function allowedRules(title: string): string[] {
  return A11Y_DEBT.filter((debt) => debt.title === title).flatMap((debt) => debt.rules);
}
