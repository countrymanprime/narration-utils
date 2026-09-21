// ui-atlas-kit 0.3.3 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
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
  // Width of the narrowest text-like control on screen at capture time, or null when there was none. Not a check on
  // its own (checkControlWidths is); it is what a threshold is calibrated from, and the teardown prints the run's minimum.
  narrowestControlPx: number | null;
}

export interface SameAsDeclaration {
  // "<page>/<state>" this state is expected to render identically to.
  of: string;
  reason: string;
  // Viewports the equivalence holds at; omitted means every viewport.
  viewports?: string[];
}

// A visible control a person types into or picks from, as measured in the page.
export interface ControlMeasurement {
  // Its accessible name (aria-label, label text, placeholder, name), so a failure says which control.
  label: string;
  // "select", "textarea" or "input[<type>]".
  kind: string;
  // getBoundingClientRect().width in CSS px.
  width: number;
}

// Controls a row declares narrow on purpose (a two-digit number box). Checked, not trusted: it fails when the control is
// no longer narrow, like sameAs. Needs a reason.
export interface NarrowControlsDeclaration {
  // Accessible names (ControlMeasurement.label) of the controls that may be narrower than the minimum.
  labels: string[];
  reason: string;
  // Viewports the allowance covers; omitted means every viewport the row is captured at.
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
// Narrower than this, a text box or select cannot show a value or be operated (a hex colour is six characters and a
// select needs its arrow). Flat, not a fraction of the container: the failure it exists for is a control squeezed to a
// sliver by a layout, and the smallest legitimate control (a colour hex box beside its swatch) is more than twice this.
export const MIN_CONTROL_WIDTH_PX = 64;
// <input> types that are not text-like: a swatch, a check box or a slider is small by design (it is not measured).
export const NON_TEXT_INPUT_TYPES: readonly string[] = ['color', 'checkbox', 'radio', 'range', 'file', 'hidden', 'button', 'submit', 'reset', 'image'];

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

// A control in the layout but narrower than the minimum has collapsed: it shrinks rather than overflows, so the sideways-
// overflow check never sees it. A width of 0 counts (it is still in the layout); a control that is not rendered at all
// is never measured in the first place.
export function findCollapsedControls(
  controls: readonly ControlMeasurement[],
  allowed: readonly string[] = [],
  minWidth: number = MIN_CONTROL_WIDTH_PX,
): ControlMeasurement[] {
  return controls.filter((control) => control.width < minWidth && !allowed.includes(control.label));
}

// What to report for one capture: each collapsed control, and each declared-narrow control that is not narrow any more
// (or is no longer on the page). A declaration limited to other viewports is neither applied nor checked here.
export function checkControlWidths(
  controls: readonly ControlMeasurement[],
  declared: NarrowControlsDeclaration | undefined,
  viewport: string,
  minWidth: number = MIN_CONTROL_WIDTH_PX,
): string[] {
  const applies = declared !== undefined && (!declared.viewports || declared.viewports.includes(viewport));
  const allowed = applies ? declared.labels : [];
  const problems = findCollapsedControls(controls, allowed, minWidth).map(
    (control) =>
      `collapsed control: "${control.label}" (${control.kind}) is ${control.width}px wide at ${viewport}, under the ${minWidth}px minimum - fix the layout, or declare narrowControls (labels and a reason) on the row in state-catalog.ts`,
  );
  if (!applies) return problems;
  for (const label of declared.labels) {
    const stillNarrow = controls.some((control) => control.label === label && control.width < minWidth);
    if (!stillNarrow)
      problems.push(`narrowControls no longer holds at ${viewport}: "${label}" is not narrower than ${minWidth}px any more - remove it from the declaration`);
  }
  return problems;
}

// The capture whose narrowest control is the narrowest of the run (undefined when no capture had one): what the
// threshold is calibrated against, printed once by the teardown.
export function findNarrowestControl(records: readonly CaptureRecord[]): (CaptureRecord & { narrowestControlPx: number }) | undefined {
  let narrowest: (CaptureRecord & { narrowestControlPx: number }) | undefined;
  for (const record of records) {
    if (record.narrowestControlPx === null) continue;
    if (!narrowest || record.narrowestControlPx < narrowest.narrowestControlPx) narrowest = { ...record, narrowestControlPx: record.narrowestControlPx };
  }
  return narrowest;
}
