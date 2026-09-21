// ui-atlas-kit 0.3.4 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as appDrivers from './app.drivers';
import { RUN_DIR, screenshotDir } from './helpers/settle';
import {
  checkAxeModeForCi,
  findBlankCaptures,
  findNarrowestControl,
  findStaleSameAs,
  findUndeclaredDuplicates,
  resolveAxeMode,
  summariseAxeRun,
  type AxeDebt,
  type CaptureRecord,
} from './lib/validators';
import { STATE_CATALOG } from './state-catalog';
import { VIEWPORTS } from './viewports';

function readRecords(): CaptureRecord[] {
  return readdirSync(RUN_DIR, { withFileTypes: true })
    .filter((viewportDir) => viewportDir.isDirectory())
    .flatMap((viewportDir) =>
      readdirSync(join(RUN_DIR, viewportDir.name)).map((file) => JSON.parse(readFileSync(join(RUN_DIR, viewportDir.name, file), 'utf8')) as CaptureRecord),
    );
}

// A renamed or removed state, or a viewport a row no longer captures, would otherwise leave its old screenshots behind
// forever, and a reviewer (or the docs sync) could mistake them for current output.
function pruneStaleScreenshots(): void {
  const root = screenshotDir('', '').replace(/\/+$/, '').replace(/\/$/, '');
  if (!existsSync(root)) return;
  const known = new Map(
    STATE_CATALOG.map((entry) => [`${entry.page}/${entry.state}`, [...VIEWPORTS, ...(entry.extraViewports ?? [])].map((viewport) => `${viewport.name}.png`)]),
  );
  for (const page of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const state of readdirSync(join(root, page.name), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const files = known.get(`${page.name}/${state.name}`);
      if (!files) {
        rmSync(join(root, page.name, state.name), { recursive: true, force: true });
        continue;
      }
      for (const file of readdirSync(join(root, page.name, state.name))) {
        if (!files.includes(file)) rmSync(join(root, page.name, state.name, file), { force: true });
      }
    }
    if (readdirSync(join(root, page.name)).length === 0) rmSync(join(root, page.name), { recursive: true, force: true });
  }
}

// Playwright runs this once before the suite; the function it returns runs
// once after. The per-test checks (console errors, overflow) can only judge one
// capture at a time - this teardown judges the run as a whole, so a screenshot
// that silently documents nothing new fails the run instead of waiting for a
// reviewer to happen to notice.
export default function globalSetup(): () => Promise<void> {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(RUN_DIR, { recursive: true });
  pruneStaleScreenshots();
  // Resolved once here as well as per capture: a mistyped UI_AXE fails the run at its start, not after every capture.
  const declaresAxeDebt = (appDrivers as { axeDebt?: readonly AxeDebt[] }).axeDebt !== undefined;
  const axeMode = resolveAxeMode(process.env.UI_AXE, declaresAxeDebt);

  return async () => {
    const records = readRecords();
    // One line for calibrating the control-width minimum: the narrowest text control of the whole run, and where it was.
    const narrowest = findNarrowestControl(records);
    if (narrowest)
      console.log(`narrowest text control this run: ${narrowest.narrowestControlPx}px in ${narrowest.page}/${narrowest.state} at ${narrowest.viewport}`);
    // Axe ran (the gate, or UI_AXE=1): what it found over the run. In the gate this is what is left as declared debt; in a
    // report-only run (UI_AXE=1) it is the whole baseline, worst rule first, with one line per state below it.
    const axeRun = summariseAxeRun(records);
    console.log(`axe mode: ${axeMode}`);
    if (axeRun.captures > 0) {
      console.log(`axe: ${axeRun.nodes} element(s) over ${axeRun.withViolations} of ${axeRun.captures} captures`);
      for (const rule of axeRun.byRule) console.log(`  ${rule.rule}: ${rule.nodes} element(s) in ${rule.captures} capture(s)`);
      if (process.env.UI_AXE === '1') {
        for (const record of records.filter((candidate) => (candidate.axe ?? []).length > 0)) {
          for (const found of record.axe ?? [])
            console.log(`  ${record.page}/${record.state} at ${record.viewport}: ${found.rule} x${found.nodes} ${found.targets.join(', ')}`);
        }
      }
    }
    const problems = [
      ...checkAxeModeForCi(axeMode, declaresAxeDebt, Boolean(process.env.CI), process.env.UI_AXE),
      ...findBlankCaptures(records).map((record) => `blank screenshot: ${record.page}/${record.state} at ${record.viewport}`),
      ...findUndeclaredDuplicates(records, STATE_CATALOG).map(
        (group) =>
          `identical screenshots at ${group.viewport}: ${group.states.join(' == ')} - fix the driver, or declare sameAs on the row in state-catalog.ts`,
      ),
      ...findStaleSameAs(records, STATE_CATALOG).map(
        (stale) => `sameAs no longer holds at ${stale.viewport}: ${stale.state} was declared identical to ${stale.of} but now differs - remove the declaration`,
      ),
    ];
    if (problems.length > 0) throw new Error(`Visual suite validation failed:\n  ${problems.join('\n  ')}`);
  };
}
