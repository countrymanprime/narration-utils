import { expect, test } from '@playwright/test';
import { RUN_DIR } from './helpers/settle';
import { checkRun, readRunRecords } from './run-checks';

// The whole-run half of the visual gate for a sharded CI run (playwright.visual-run.config.ts, `pnpm run visual:check-run`):
// each shard captured part of the catalog with its own whole-run checks deferred (UI_VISUAL_SHARDED=1), and the merge job
// puts every shard's capture records in one run directory and judges them here. No browser: it reads the records only.
test('the whole visual run: complete, no blank capture, no undeclared duplicate, no stale sameAs', () => {
  const records = readRunRecords(process.env.UI_VISUAL_RUN_DIR ?? RUN_DIR);
  const { notes, problems } = checkRun(records, { requireComplete: true });
  console.log(`${records.length} capture records`);
  for (const note of notes) console.log(note);
  expect(problems, `Visual suite validation failed:\n  ${problems.join('\n  ')}`).toEqual([]);
});
