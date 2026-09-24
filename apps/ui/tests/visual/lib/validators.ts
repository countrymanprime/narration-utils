// ui-atlas-kit 0.3.6 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
// Pure checks over what one visual-suite run captured. Kept free of Playwright
// and Node APIs so they are unit-tested by Vitest (src/visualSuite.test.ts) and
// reused unchanged by global-setup.ts's post-run teardown.

// One axe rule that a page reported in one capture (the run's violations, grouped by rule).
export interface AxeFinding {
  // axe's rule id, for example "color-contrast".
  rule: string;
  impact: string | null;
  // What axe says to do about it (its `help` text), so a failure explains itself.
  help: string;
  // How many elements broke the rule in this capture.
  nodes: number;
  // Selectors of the first few of them (AXE_TARGET_LIMIT).
  targets: string[];
}

// Rules a state is KNOWN to violate, each with the reason and where the fix belongs: the app-state counterpart of a
// story's A11Y_DEBT. An escape hatch, not a default: an entry hides a real failure, so it needs a reason, the list may only
// shrink (the project's test caps its length), and it is checked like sameAs: it fails when the rule stops being reported.
export interface AxeDebt {
  page: string;
  state: string;
  rules: string[];
  reason: string;
  // Viewports the entry covers; omitted means every viewport the row is captured at.
  viewports?: string[];
}

// An absolutely positioned element under the app root whose containing block escaped the shell (its offsetParent is
// <body> or null, so it lays out and scrolls against the document instead of the app's own scroll container).
export interface EscapedAbsolute {
  // A short CSS-ish path to the element, for a failure to point at.
  selector: string;
  // getBoundingClientRect().bottom at capture time, in document px.
  bottom: number;
}

// Opt-in for the vertical-overflow and escaped-absolute checks (app-shell-vertical-overflow.prd.md). A project declares
// `documentScroll = 'locked'` from its drivers once every page scrolls inside the shell's own scroll container and the
// document itself never scrolls; there is no per-row escape hatch (Q3 A), because a real escape belongs to every window
// size and zoom level, not one row's problem.
export type DocumentScrollMode = 'locked';

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
  // documentElement.scrollHeight - clientHeight at capture time. Recorded regardless of documentScroll, like overflowPx;
  // only fails the capture when the project opts in.
  overflowYPx: number;
  // Absolutely positioned elements under the app root whose containing block is the document, found regardless of
  // documentScroll; only fails the capture when the project opts in.
  escapedAbsolutes: EscapedAbsolute[];
  // Width of the narrowest text-like control on screen at capture time, or null when there was none. Not a check on
  // its own (checkControlWidths is); it is what a threshold is calibrated from, and the teardown prints the run's minimum.
  narrowestControlPx: number | null;
  // What axe reported for this capture, grouped by rule; undefined when axe did not run (it is off unless the project
  // declares axeDebt or a run sets UI_AXE=1), an empty list when it ran and found nothing.
  axe?: AxeFinding[];
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
export const VERTICAL_OVERFLOW_TOLERANCE_PX = 1;
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

// Problems for one capture's vertical-overflow measurement and escaped-absolute scan. Both are recorded on every capture
// (see CaptureRecord), but only fail it when the project opts into documentScroll: 'locked' - a project that has not
// finished getting every page onto one scroll container is not held to it yet.
export function checkDocumentScroll(overflowYPx: number, escaped: readonly EscapedAbsolute[], mode: DocumentScrollMode | undefined): string[] {
  if (mode !== 'locked') return [];
  const problems: string[] = [];
  if (overflowYPx > VERTICAL_OVERFLOW_TOLERANCE_PX)
    problems.push(`the document scrolls vertically by ${overflowYPx}px - the page area should be the only scroll container`);
  for (const element of escaped)
    problems.push(
      `escaped the shell's containing block: ${element.selector} is absolutely positioned but lays out against the document (bottom ${element.bottom}px) - give its container position: relative`,
    );
  return problems;
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

// Two controls with one name (a repeated row of fields, or unlabelled inputs that fall back to their tag) would share an
// allowance and hide each other's collapse. The second and later ones are numbered ("Model (2)") so a failure and a
// narrowControls entry each address one control.
export function disambiguateLabels(controls: readonly ControlMeasurement[]): ControlMeasurement[] {
  const seen = new Map<string, number>();
  return controls.map((control) => {
    const count = (seen.get(control.label) ?? 0) + 1;
    seen.set(control.label, count);
    return count === 1 ? control : { ...control, label: `${control.label} (${count})` };
  });
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

// How many selectors of a rule's offending elements a finding lists (enough to find them, not a page of markup).
export const AXE_TARGET_LIMIT = 3;

// The part of axe's `results.violations` this suite reads (kept structural so nothing here imports axe-core).
export interface RawAxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target: unknown[] }[];
}

// A node's target is a selector path: a plain array of selectors, or nested arrays where the element sits in a shadow root
// or a frame. Read it as one string.
function targetText(target: unknown[]): string {
  return target.flat(Infinity).map(String).join(' ');
}

// Sorted by rule id, so two runs over the same page produce the same record.
export function summariseAxeViolations(violations: readonly RawAxeViolation[]): AxeFinding[] {
  return violations
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact ?? null,
      help: violation.help,
      nodes: violation.nodes.length,
      targets: violation.nodes.slice(0, AXE_TARGET_LIMIT).map((node) => targetText(node.target)),
    }))
    .sort((a, b) => a.rule.localeCompare(b.rule));
}

function debtApplies(entry: AxeDebt, page: string, state: string, viewport: string): boolean {
  return entry.page === page && entry.state === state && (!entry.viewports || entry.viewports.includes(viewport));
}

// What to report for one capture: each rule the page violates that nothing declares, and each declared rule that the page no
// longer violates (an entry is an allowlist entry, and an allowlist only stays honest if it fails when it stops being
// needed). An entry limited to other viewports is neither applied nor checked here.
export function checkAxeFindings(findings: readonly AxeFinding[], debt: readonly AxeDebt[], page: string, state: string, viewport: string): string[] {
  const declared = debt.filter((entry) => debtApplies(entry, page, state, viewport));
  const allowed = new Set(declared.flatMap((entry) => entry.rules));
  const problems = findings
    .filter((found) => !allowed.has(found.rule))
    .map(
      (found) =>
        `accessibility: axe "${found.rule}" (${found.impact ?? 'no impact given'}) on ${found.nodes} node${found.nodes === 1 ? '' : 's'} at ${viewport}: ${found.help} - e.g. ${found.targets.join(', ')} - fix the page, or declare axeDebt (rules and a reason) for this state in the project's drivers`,
    );
  const reported = new Set(findings.map((found) => found.rule));
  for (const rule of allowed) {
    if (!reported.has(rule)) problems.push(`axeDebt no longer holds at ${viewport}: axe does not report "${rule}" any more - remove it from the declaration`);
  }
  return problems;
}

export type AxeMode = 'off' | 'report' | 'gate';

// Whether axe runs on the app's states and whether a violation fails the capture. Off unless the project declares an
// `axeDebt` list in its drivers (the gate: any violation the list does not declare fails) or a run sets UI_AXE. UI_AXE=1 is
// the report-only baseline (nothing fails; the teardown prints what axe found), UI_AXE=0 skips it for a quick local run and
// UI_AXE=gate forces the gate for a project with no list yet. A mistyped value throws: a typo must not silently turn a gate off.
export function resolveAxeMode(env: string | undefined, projectDeclaresDebt: boolean): AxeMode {
  if (env === undefined || env === '') return projectDeclaresDebt ? 'gate' : 'off';
  if (env === '0') return 'off';
  if (env === '1') return 'report';
  if (env === 'gate') return 'gate';
  throw new Error(`UI_AXE must be 0 (off), 1 (report only) or gate, got "${env}"`);
}

// What is wrong with the axe mode of a run on CI: the gate a project declared (`axeDebt`) was switched off (UI_AXE=0) or
// turned into a report (UI_AXE=1), so a green run proves nothing about accessibility. Those values are for a developer's
// shell; a leftover in a CI environment must not pass quietly. `env` is the UI_AXE value, passed in to keep this pure.
export function checkAxeModeForCi(mode: AxeMode, projectDeclaresDebt: boolean, onCi: boolean, env: string | undefined): string[] {
  if (!onCi || !projectDeclaresDebt || mode === 'gate') return [];
  return [`UI_AXE=${env ?? ''} runs axe as "${mode}" on CI, but this project declares axeDebt: unset UI_AXE so the gate runs`];
}

export interface AxeRunSummary {
  // Captures axe ran on.
  captures: number;
  // Of those, the ones with at least one violation.
  withViolations: number;
  // Offending elements over the whole run.
  nodes: number;
  // Per rule, worst first: nodes over the run and how many captures reported it.
  byRule: { rule: string; nodes: number; captures: number }[];
}

// The report-only baseline (UI_AXE=1): how much axe finds across the app's states before any of it is gated.
export function summariseAxeRun(records: readonly CaptureRecord[]): AxeRunSummary {
  const measured = records.filter((record) => record.axe !== undefined);
  const byRule = new Map<string, { nodes: number; captures: number }>();
  for (const record of measured) {
    for (const found of record.axe ?? []) {
      const total = byRule.get(found.rule) ?? { nodes: 0, captures: 0 };
      byRule.set(found.rule, { nodes: total.nodes + found.nodes, captures: total.captures + 1 });
    }
  }
  return {
    captures: measured.length,
    withViolations: measured.filter((record) => (record.axe ?? []).length > 0).length,
    nodes: [...byRule.values()].reduce((sum, total) => sum + total.nodes, 0),
    byRule: [...byRule.entries()].map(([rule, total]) => ({ rule, ...total })).sort((a, b) => b.nodes - a.nodes || a.rule.localeCompare(b.rule)),
  };
}
