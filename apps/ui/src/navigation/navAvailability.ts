import { dawCapabilityGate } from '../dawAvailability';

/** What the project must have before a page is offered. A page asks for none by default. */
export type Precondition = 'manuscript' | 'dawFile';

/** The project facts the preconditions are judged against. */
export type NavFacts = { hasManuscript: boolean; dawFileLinked: boolean };

/**
 * What each rail page needs, the one place that says so. The rail, the drawer and the jump menu read it through
 * `navAvailability`; no item carries a condition of its own. A page reached any other way still draws its own "import a
 * manuscript" state, so this table decides what is offered, not what can be opened.
 */
export const NAV_PRECONDITIONS: Readonly<Record<string, readonly Precondition[]>> = {
  // Production is where the import lives, and Settings holds the project and DAW setup: neither waits on a manuscript.
  '/': [],
  '/settings': [],
  '/schedule': ['manuscript'],
  '/script': ['manuscript'],
  '/story-bible': ['manuscript'],
  '/booth': ['manuscript'],
  '/editing': ['manuscript'],
  '/proof': ['manuscript'],
  '/pickups': ['manuscript'],
  '/master': ['manuscript'],
  '/delivery': ['manuscript'],
};

/** Whether `path` is offered, and when it is not, the sentence that says what unlocks it. A path the table does not list is offered. */
export function navAvailability(path: string, facts: NavFacts): { disabled: boolean; reason?: string } {
  const needs = NAV_PRECONDITIONS[path] ?? [];
  return dawCapabilityGate(
    { manuscript: needs.includes('manuscript') && !facts.hasManuscript, dawFile: needs.includes('dawFile') && !facts.dawFileLinked },
    { level: 'supported', available: true },
  );
}
