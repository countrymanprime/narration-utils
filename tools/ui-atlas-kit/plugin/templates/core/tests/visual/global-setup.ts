// ui-atlas-kit 0.3.1 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_DIR, screenshotDir } from './helpers/settle';
import { findBlankCaptures, findStaleSameAs, findUndeclaredDuplicates, type CaptureRecord } from './lib/validators';
import { STATE_CATALOG } from './state-catalog';

function readRecords(): CaptureRecord[] {
  return readdirSync(RUN_DIR, { withFileTypes: true })
    .filter((viewportDir) => viewportDir.isDirectory())
    .flatMap((viewportDir) =>
      readdirSync(join(RUN_DIR, viewportDir.name)).map((file) => JSON.parse(readFileSync(join(RUN_DIR, viewportDir.name, file), 'utf8')) as CaptureRecord),
    );
}

// A renamed or removed state would otherwise leave its old screenshots behind forever, and a reviewer
// (or the docs sync) could mistake them for current output.
function pruneStaleScreenshots(): void {
  const root = screenshotDir('', '').replace(/\/+$/, '').replace(/\/$/, '');
  if (!existsSync(root)) return;
  const known = new Set(STATE_CATALOG.map((entry) => `${entry.page}/${entry.state}`));
  for (const page of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const state of readdirSync(join(root, page.name), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      if (!known.has(`${page.name}/${state.name}`)) rmSync(join(root, page.name, state.name), { recursive: true, force: true });
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

  return async () => {
    const records = readRecords();
    const problems = [
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
