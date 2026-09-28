// The interaction feedback rows for the Pickups call sites (see interactionFeedback.catalog.ts for what a row says): the
// Pickups page (stage-navigation-and-page-replacement.prd.md Phase 7, the Tracks page's Pickups dialog until then) and the
// pickups state it shares with the Booth companion's Pickups section.
import { type FeedbackRow, row, subscription } from './row';

// prettier-ignore
export const pickupsFeedback: Record<string, FeedbackRow> = {
  'src/components/pickups/usePickupsState.ts::pickupsState#1': row('mount', 'instant', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Hydrates whatever run was already in flight when the page or the Booth companion opened; the live event follows anyway.'),
  'src/components/pickups/usePickupsState.ts::subscribePickups#1': subscription('The pickups state event, shared by every import, export, next, resolve and count run the Pickups page starts; the Booth companion only reads it.'),
  'src/components/pickups/usePickupsState.ts::pickupsCount#1': row(
    'mount',
    'job',
    'na',
    'na',
    'ui',
    'silent',
    'na',
    'exempt',
    'An automatic refresh right after the hydrate above settles, so the remaining count is current without an extra press; a failure here just leaves the count at whatever the hydrate answered, and the narrator can still press Import, Next or Export, each of which shows its own failure inline.',
  ),
  'src/components/pickups/PickupsPage.tsx::pickupsImport#1': row('input', 'job', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Choosing a CSV file. Row errors and the import summary show inline; a request failure shows as an alert.'),
  'src/components/pickups/PickupsPage.tsx::pickupsNext#1': row('click', 'job', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'A failure (no pickups remain) shows as an alert.'),
  'src/components/pickups/PickupsPage.tsx::pickupsResolve#1': row('click', 'job', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'A failure (no open pickup at that position) shows as an alert.'),
  'src/components/pickups/PickupsPage.tsx::pickupsPunch#1': row('click', 'job', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Moves REAPER\'s edit cursor to the pickup\'s own position minus the pre-roll setting (booth-actions-enablement PRD Phase 3); no preview step, since the position is already known. A refusal (no DAW, or REAPER refuses the move) shows as an alert; nothing moves.'),
  'src/components/pickups/PickupsPage.tsx::pickupsExport#1': row('click', 'job', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'A completed export triggers the browser file-save download; a failure shows as an alert.'),
  'src/components/pickups/PickupsPage.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Read with the chapter links and tracks only to find which chapter a pickup falls in; without them a pickup just has no "Open in Proof" link, and it says so.'),
  'src/components/pickups/PickupsPage.tsx::chapterTrackMapList#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'The confirmed chapter links, read with the chapters and tracks above for the same "Open in Proof" link.'),
  'src/components/pickups/PickupsPage.tsx::tracksList#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'The linked project file\'s tracks and items, read with the chapters and links above to place a pickup\'s project time in its chapter.'),
};
