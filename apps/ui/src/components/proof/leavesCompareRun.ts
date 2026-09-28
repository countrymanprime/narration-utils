/** Whether a move leaves a Proof chapter view while its compare run is under way or showing results
 * (stage-navigation-and-page-replacement.prd.md Phase 5: the retired Proofing page reset its run on leaving, and the
 * run now lives in the chapter view). `to` is undefined for Back/Forward, which always leave the page. */
export function leavesCompareRun(from: string, to: string | undefined, phase: string): boolean {
  return from.startsWith('/proof/') && to !== from && phase !== 'idle';
}
