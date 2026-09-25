import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as appDrivers from './app.drivers';
import { RUN_DIR } from './helpers/settle';
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

// The checks that judge a visual run as a whole: blank captures, undeclared duplicates, stale sameAs, and the axe mode
// the gate ran in. A single run applies them in global-setup.ts's teardown; a sharded CI run defers them there
// (UI_VISUAL_SHARDED=1) and applies them once over every shard's records in whole-run.check.ts, because a duplicate or a
// stale sameAs can pair two states that ran in different shards.

export function readRunRecords(dir: string = RUN_DIR): CaptureRecord[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((viewportDir) => viewportDir.isDirectory())
    .flatMap((viewportDir) =>
      readdirSync(join(dir, viewportDir.name)).map((file) => JSON.parse(readFileSync(join(dir, viewportDir.name, file), 'utf8')) as CaptureRecord),
    );
}

const captureKey = (viewport: string, page: string, state: string): string => `${page}/${state} at ${viewport}`;

// Every capture a full run writes a record for: each catalog row that has a driver, at each of its viewports.
export function missingCaptures(records: readonly CaptureRecord[]): string[] {
  const have = new Set(records.map((record) => captureKey(record.viewport, record.page, record.state)));
  return STATE_CATALOG.filter((entry) => appDrivers.APP_DRIVERS[entry.page]?.[entry.state])
    .flatMap((entry) => [...VIEWPORTS, ...(entry.extraViewports ?? [])].map((viewport) => captureKey(viewport.name, entry.page, entry.state)))
    .filter((key) => !have.has(key));
}

export function axeModeOfRun(): { axeMode: ReturnType<typeof resolveAxeMode>; declaresAxeDebt: boolean } {
  const declaresAxeDebt = (appDrivers as { axeDebt?: readonly AxeDebt[] }).axeDebt !== undefined;
  return { axeMode: resolveAxeMode(process.env.UI_AXE, declaresAxeDebt), declaresAxeDebt };
}

// `requireComplete` is for the merged run: a shard whose records never arrived would otherwise shrink the set the
// duplicate and sameAs checks compare, and pass. A single run leaves it off: `-g` runs a subset on purpose.
export function checkRun(records: readonly CaptureRecord[], { requireComplete = false } = {}): { notes: string[]; problems: string[] } {
  const { axeMode, declaresAxeDebt } = axeModeOfRun();
  const notes: string[] = [];
  // One line for calibrating the control-width minimum: the narrowest text control of the whole run, and where it was.
  const narrowest = findNarrowestControl(records);
  if (narrowest)
    notes.push(`narrowest text control this run: ${narrowest.narrowestControlPx}px in ${narrowest.page}/${narrowest.state} at ${narrowest.viewport}`);
  // Axe ran (the gate, or UI_AXE=1): what it found over the run. In the gate this is what is left as declared debt; in a
  // report-only run (UI_AXE=1) it is the whole baseline, worst rule first, with one line per state below it.
  const axeRun = summariseAxeRun(records);
  notes.push(`axe mode: ${axeMode}`);
  if (axeRun.captures > 0) {
    notes.push(`axe: ${axeRun.nodes} element(s) over ${axeRun.withViolations} of ${axeRun.captures} captures`);
    for (const rule of axeRun.byRule) notes.push(`  ${rule.rule}: ${rule.nodes} element(s) in ${rule.captures} capture(s)`);
    if (process.env.UI_AXE === '1') {
      for (const record of records.filter((candidate) => (candidate.axe ?? []).length > 0)) {
        for (const found of record.axe ?? [])
          notes.push(`  ${record.page}/${record.state} at ${record.viewport}: ${found.rule} x${found.nodes} ${found.targets.join(', ')}`);
      }
    }
  }
  const problems = [
    ...(requireComplete ? missingCaptures(records).map((key) => `no record of ${key}: a shard did not run it or its records were not merged`) : []),
    ...checkAxeModeForCi(axeMode, declaresAxeDebt, Boolean(process.env.CI), process.env.UI_AXE),
    ...findBlankCaptures(records).map((record) => `blank screenshot: ${record.page}/${record.state} at ${record.viewport}`),
    ...findUndeclaredDuplicates(records, STATE_CATALOG).map(
      (group) => `identical screenshots at ${group.viewport}: ${group.states.join(' == ')} - fix the driver, or declare sameAs on the row in state-catalog.ts`,
    ),
    ...findStaleSameAs(records, STATE_CATALOG).map(
      (stale) => `sameAs no longer holds at ${stale.viewport}: ${stale.state} was declared identical to ${stale.of} but now differs - remove the declaration`,
    ),
  ];
  return { notes, problems };
}
