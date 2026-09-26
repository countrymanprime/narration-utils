// The interaction feedback rows for the workspace call sites (see interactionFeedback.catalog.ts for what a row says).
import { type FeedbackRow, row, subscription } from './row';

// prettier-ignore
export const workspaceFeedback: Record<string, FeedbackRow> = {
  // Chapter workspace (edit-and-proof-workspace.prd.md Phase 2): the chapter, its linked track's items and its
  // stored alignment are all loaded together on mount; a failure in any of the first three (they run inside one
  // Promise.all) shows the same page-level inline error, since none of them is useful without the others.
  'src/components/workspace/WorkspacePage.tsx::manuscriptChapters#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Finds the chapter by id from the route; a failure shows the page\'s inline error.'),
  'src/components/workspace/WorkspacePage.tsx::chapterTrackMapList#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Finds the chapter\'s linked track, same as ChapterLinksTable\'s own read of the same binding.'),
  'src/components/workspace/WorkspacePage.tsx::tracksList#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'The linked track\'s items, to build the playlist honouring their played ranges.'),
  'src/components/workspace/WorkspacePage.tsx::workspaceAlignment#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Reads the chapter\'s stored word alignment on open and again after a check completes (never runs one, Q14); a failure is the page\'s own inline error.'),
  'src/components/workspace/WorkspacePage.tsx::subscribeCoverage#1': subscription('The recording check state, same subscription and job dialog (RecordingCheck) Home\'s own row uses.'),

};
