// ADR 0069, rule 4: every payload the Go host and the Python sidecars write to tests/fixtures/contracts/ is checked by the
// schema the app runs (wireContracts.test.ts). One row per committed file, in the file for its feature area: a new golden
// file with no row fails that test, and so does a row whose file is missing. A file named in two feature areas fails here.
import type { z } from 'zod';
import { systemGoldens } from './system';
import { proofingGoldens } from './proofing';
import { teleprompterGoldens } from './teleprompter';
import { manuscriptGoldens } from './manuscript';
import { storyBibleGoldens } from './storyBible';
import { projectGoldens } from './project';
import { creditsGoldens } from './credits';
import { assetsGoldens } from './assets';
import { settingsGoldens } from './settings';
import { updateGoldens } from './update';
import { chapterTracksGoldens } from './chapterTracks';
import { reaperActionsGoldens } from './reaperActions';
import { reviewGoldens } from './review';
import { coverageGoldens } from './coverage';
import { editingGoldens } from './editing';
import { workspaceGoldens } from './workspace';
import { previewGoldens } from './preview';
import { stagesGoldens } from './stages';
import { deliveryGoldens } from './delivery';

const FEATURE_AREAS: Array<Record<string, z.ZodType>> = [
  systemGoldens,
  proofingGoldens,
  teleprompterGoldens,
  manuscriptGoldens,
  storyBibleGoldens,
  projectGoldens,
  creditsGoldens,
  assetsGoldens,
  settingsGoldens,
  updateGoldens,
  chapterTracksGoldens,
  reaperActionsGoldens,
  reviewGoldens,
  coverageGoldens,
  editingGoldens,
  workspaceGoldens,
  previewGoldens,
  stagesGoldens,
  deliveryGoldens,
];

/** Which schema owns each golden file, over every feature area. */
export const GOLDEN: Record<string, z.ZodType> = {};
for (const rows of FEATURE_AREAS) {
  for (const [file, schema] of Object.entries(rows)) {
    if (Object.hasOwn(GOLDEN, file)) throw new Error(`${file} has a golden row in two feature areas`);
    GOLDEN[file] = schema;
  }
}
