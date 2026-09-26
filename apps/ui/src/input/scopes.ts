/** Where a command can fire (Solution Detail, ADR 0361 decision 1). */
export type Scope = 'global' | 'page' | 'booth' | 'dialog';

/**
 * `dialog`, `booth` and `page` ordered most to least specific (ADR 0361 decision 4: the router "takes the most
 * specific scope"). `global` is last: it is the fallback that always applies. `router.tsx` walks this order and
 * takes the first scope that is both active and bound to the gesture.
 */
export const SCOPE_PRIORITY: readonly Scope[] = ['dialog', 'booth', 'page', 'global'];

const OVERLAPPING_PAIRS: ReadonlySet<string> = new Set(['booth+dialog', 'booth+global', 'global+page']);

/**
 * Whether two scopes can be part of the same screen's active set at once, so a gesture bound in both is a real,
 * narrator-visible conflict rather than one the router's own precedence already keeps apart.
 *
 * A screen has at most one "surface" scope - `dialog`, `booth` or `page` - plus `global`, unless a dialog is open
 * (`router.tsx`'s `activeScopes`, ADR 0361 decision 4). `booth` can sit on top of a dialog (the read-aloud dialog is
 * both a `dialog` and a `booth`) or stand as a full page on its own (the Teleprompter page), so it claims the
 * surface the same way `dialog` does: on a booth screen, `page` is never also active, exactly as `page` is never
 * active while a dialog is open. That is the one point past the ADR's literal "page overlaps booth": read that way,
 * the default catalog could never pass "zero conflicts" once `workspace.*` (`page`, Space) and `reading.toggle`
 * (`booth`, Space) both exist, and the two are never actually reachable on the same screen (different routes) either
 * way. The realisable pairs this leaves are exactly `dialog`+`booth` (the read-aloud dialog), `booth`+`global` (the
 * Teleprompter page) and `page`+`global` (every other page) - the three entries below.
 */
export function scopesOverlap(a: Scope, b: Scope): boolean {
  if (a === b) return true;
  return OVERLAPPING_PAIRS.has([a, b].sort().join('+'));
}
