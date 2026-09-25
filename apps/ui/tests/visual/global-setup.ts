import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_DIR, screenshotDir } from './helpers/settle';
import { axeModeOfRun, checkRun, readRunRecords } from './run-checks';
import { STATE_CATALOG } from './state-catalog';
import { VIEWPORTS } from './viewports';

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
// capture at a time - this teardown judges the run as a whole (run-checks.ts), so a
// screenshot that silently documents nothing new fails the run instead of waiting
// for a reviewer to happen to notice. A CI shard (UI_VISUAL_SHARDED=1) sees only
// part of the run, so it leaves that to whole-run.check.ts over every shard's records.
export default function globalSetup(): () => Promise<void> {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(RUN_DIR, { recursive: true });
  pruneStaleScreenshots();
  // Resolved once here as well as per capture: a mistyped UI_AXE fails the run at its start, not after every capture.
  axeModeOfRun();

  return async () => {
    if (process.env.UI_VISUAL_SHARDED === '1') {
      console.log('whole-run checks deferred: this is one shard; whole-run.check.ts judges the merged records');
      return;
    }
    const { notes, problems } = checkRun(readRunRecords());
    for (const note of notes) console.log(note);
    if (problems.length > 0) throw new Error(`Visual suite validation failed:\n  ${problems.join('\n  ')}`);
  };
}
