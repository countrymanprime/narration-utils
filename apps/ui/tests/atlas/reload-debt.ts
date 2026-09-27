// Stories that must get a fresh page load for every theme/viewport variant even though they have no play() function
// (ADR 0267: atlas groups a story's variants into one page load, switching theme and resizing instead of reloading).
// This is an escape hatch, not a default: an entry here means the side-by-side diff that ADR describes found the
// story rendering differently after a switch than after a fresh load, so it opts back into the old, safe-but-slower
// behaviour. Each entry names the reason a switch is not safe for it; the list may only grow when a real difference
// is found (run with and without the grouping and diff the PNGs), never as a guess.
export interface ReloadDebt {
  // Story title (e.g. 'Primitives/WorkDialog'); matches every story of that component.
  title: string;
  reason: string;
}

export const RELOAD_DEBT: ReloadDebt[] = [];

export function needsFreshLoad(title: string): boolean {
  return RELOAD_DEBT.some((debt) => debt.title === title);
}
