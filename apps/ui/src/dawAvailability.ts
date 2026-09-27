import type { CapabilityEntry } from './components/primitives/CapabilityGate';

/**
 * Which requirements a disabled control is missing, so its tooltip can name all of them at once instead of just the
 * first (docs/prds/project-workspace-and-daw-link.prd.md, Open Question W17: "a combined reason listing what is
 * missing"). The two are independent - a page can need a manuscript, a linked DAW project file, or both, and the
 * single shared `MANUSCRIPT_REQUIRED_REASON` string this repo has today (AppShell.tsx) cannot express the second.
 */
export interface MissingRequirements {
  manuscript: boolean;
  dawFile: boolean;
}

const REQUIREMENT_PHRASES: { key: keyof MissingRequirements; phrase: string }[] = [
  { key: 'manuscript', phrase: 'import a manuscript' },
  { key: 'dawFile', phrase: 'link a REAPER project' },
];

/**
 * Builds the single sentence a disabled nav item, route or button shows for what unlocks it (W17). `missing` names
 * which requirements are currently unmet; a requirement the caller does not care about is simply passed as `false`.
 * Returns `undefined` when nothing is missing, meaning the caller has no reason to disable anything.
 *
 * `dawFile` here means "not linked" (a stored fact, PRD W13/W14): whether the DAW is reachable or has the matching
 * project open are separate facts that Phase 6 of the PRD adds and are not part of this reason yet.
 */
export function combinedRequiredReason(missing: MissingRequirements): string | undefined {
  const phrases = REQUIREMENT_PHRASES.filter(({ key }) => missing[key]).map(({ phrase }) => phrase);
  if (phrases.length === 0) return undefined;
  const joined = phrases.length === 1 ? phrases[0] : phrases.join(' and ');
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)} to unlock this page.`;
}

/**
 * Whether a `requiresDaw` nav item is disabled, and why (DAW port PRD Phase 7, ADR 0360's "the nav's `requiresDaw`
 * move onto the gate"). The stored setup facts (a manuscript imported, a project file linked) take precedence over
 * `capability`, since they are unrelated to what the DAW can do right now and `combinedRequiredReason` already
 * names them; once they are met, whether the page is actually usable comes from the DAW port's own capability entry
 * (`useCapability`) rather than a fixed message, so a narrator learns "REAPER is not answering" or "Experimental:
 * switched off in Settings" instead of just "link a REAPER project" once one already is linked.
 */
export function dawCapabilityGate(missing: MissingRequirements, capability: CapabilityEntry): { disabled: boolean; reason?: string } {
  const setupReason = combinedRequiredReason(missing);
  if (setupReason) return { disabled: true, reason: setupReason };
  return capability.available ? { disabled: false } : { disabled: true, reason: capability.message };
}
