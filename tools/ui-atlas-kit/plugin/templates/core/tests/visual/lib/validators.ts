// ui-atlas-kit 0.3.0 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
// Pure checks over what one visual-suite run captured. Kept free of Playwright
// and Node APIs so they are unit-tested by Vitest (src/visualSuite.test.ts) and
// reused unchanged by global-setup.ts's post-run teardown.

export interface CaptureRecord {
  page: string;
  state: string;
  viewport: string;
  // sha256 of the PNG bytes. Identifies a file; it is NOT how two screenshots are
  // compared, because sub-pixel anti-aliasing changes bytes without changing the picture.
  hash: string;
  // The image shrunk to a small greyscale grid (see SIGNATURE_WIDTH/HEIGHT). Coarse on purpose:
  // it only forgives anti-aliasing jitter on declared sameAs pairs, it never proves two states differ or match.
  signature: number[];
  // Largest per-channel standard deviation of the pixels (0-255 scale). A
  // uniform image (blank page, white screen of death) has ~0.
  maxChannelStdev: number;
  // documentElement.scrollWidth - clientWidth at capture time.
  overflowPx: number;
}

export interface SameAsDeclaration {
  // "<page>/<state>" this state is expected to render identically to.
  of: string;
  reason: string;
  // Viewports the equivalence holds at; omitted means every viewport.
  viewports?: string[];
}

export interface DeclaredState {
  page: string;
  state: string;
  sameAs?: SameAsDeclaration;
}

export interface DuplicateGroup {
  viewport: string;
  states: string[];
}

export interface StaleSameAs {
  state: string;
  of: string;
  viewport: string;
}

export const SIGNATURE_WIDTH = 64;
export const SIGNATURE_HEIGHT = 36;
// Largest per-cell brightness difference (0-255) still treated as the same picture: above
// anti-aliasing noise, below a tooltip or a changed control.
export const SIGNATURE_TOLERANCE = 3;
export const BLANK_STDEV_THRESHOLD = 1;
export const OVERFLOW_TOLERANCE_PX = 1;

const stateKey = (page: string, state: string): string => `${page}/${state}`;

export function isSameImage(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((cell, index) => Math.abs(cell - (b[index] ?? Number.NaN)) <= SIGNATURE_TOLERANCE);
}

export function findBlankCaptures(records: readonly CaptureRecord[]): CaptureRecord[] {
  return records.filter((record) => record.maxChannelStdev < BLANK_STDEV_THRESHOLD);
}

export function findOverflowingCaptures(records: readonly CaptureRecord[]): CaptureRecord[] {
  return records.filter((record) => record.overflowPx > OVERFLOW_TOLERANCE_PX);
}

function declaresSameAs(declared: readonly DeclaredState[], key: string, otherKey: string, viewport: string): boolean {
  return declared.some((entry) => {
    if (stateKey(entry.page, entry.state) !== key || entry.sameAs?.of !== otherKey) return false;
    return !entry.sameAs.viewports || entry.sameAs.viewports.includes(viewport);
  });
}

// Two states that render byte-identical at the same viewport are a screenshot
// that documents nothing new - typically a driver that silently no-ops - unless
// a catalog row says on purpose that one is the same as the other. Exact bytes,
// not a fuzzy match: a coarse comparison cannot tell a few-pixel glyph change
// (Play -> Pause) from anti-aliasing noise, and a missed real difference is worse
// than a missed duplicate.
export function findUndeclaredDuplicates(records: readonly CaptureRecord[], declared: readonly DeclaredState[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const viewport of new Set(records.map((record) => record.viewport))) {
    const clusters: CaptureRecord[][] = [];
    for (const record of records.filter((candidate) => candidate.viewport === viewport)) {
      const cluster = clusters.find((members) => members[0]?.hash === record.hash);
      if (cluster) cluster.push(record);
      else clusters.push([record]);
    }
    for (const members of clusters) {
      if (members.length < 2) continue;
      const keys = members.map((member) => stateKey(member.page, member.state));
      const undeclared = keys.filter((key) => !keys.some((other) => other !== key && declaresSameAs(declared, key, other, viewport)));
      // One member is the "original"; the rest must each point at a sibling.
      if (undeclared.length > 1) groups.push({ viewport, states: undeclared });
    }
  }
  return groups;
}

// A sameAs declaration is an allowlist entry; an allowlist only stays honest if
// it fails when the two states start rendering differently. Anti-aliasing noise
// (isSameImage) is forgiven here - and only here - so a declared pair does not
// fail the run over sub-pixel jitter.
export function findStaleSameAs(records: readonly CaptureRecord[], declared: readonly DeclaredState[]): StaleSameAs[] {
  const byViewportAndKey = new Map<string, CaptureRecord>();
  for (const record of records) byViewportAndKey.set(`${record.viewport}::${stateKey(record.page, record.state)}`, record);

  const stale: StaleSameAs[] = [];
  for (const entry of declared) {
    if (!entry.sameAs) continue;
    const key = stateKey(entry.page, entry.state);
    for (const viewport of new Set(records.map((record) => record.viewport))) {
      if (entry.sameAs.viewports && !entry.sameAs.viewports.includes(viewport)) continue;
      const mine = byViewportAndKey.get(`${viewport}::${key}`);
      const theirs = byViewportAndKey.get(`${viewport}::${entry.sameAs.of}`);
      if (mine && theirs && mine.hash !== theirs.hash && !isSameImage(mine.signature, theirs.signature))
        stale.push({ state: key, of: entry.sameAs.of, viewport });
    }
  }
  return stale;
}
