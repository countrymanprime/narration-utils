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

  // Findings in the text (edit-and-proof-workspace.prd.md Phase 4): the chapter's findings overlay onto the check's
  // own flags (findingFlags.ts's overlayFindings, a pure function - no host call, no row of its own).
  'src/components/workspace/WorkspacePage.tsx::findingsList#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Reads the chapter\'s findings for the text overlay, on open and again after a decision; not a narrator action to retry, and not swallowed silently since the check-derived flags (Phase 2) still show with nothing lost on a failure (interactionFeedback.catalog.ts SILENT_CATCHES).'),
  'src/components/workspace/WorkspacePage.tsx::findingsReview#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'yes', 'ok', 'Accept, Dismiss and Defer run one at a time through usePendingAction (FlagsPanel.tsx\'s FlagDecision, keyed by the flag\'s finding so a new selection gets a fresh note field): the pressed button is busy, the others are off, "Saved as ..." is announced and the findings reload, updating the flag\'s own decision line - the same binding review/FindingDetail.tsx uses, so it shows there too. A refusal is an inline alert in plain words.'),

  // Go to and Loop in REAPER for the word at the playhead (edit-and-proof-workspace.prd.md Phase 3, useWorkspaceReaper.ts):
  // the same round trip through the REAPER file bridge as the Review page's ReaperControls.tsx rows, over WorkspaceGoTo/
  // WorkspaceLoop/FindingsStopLoop instead of a finding's own bindings.
  'src/components/workspace/useWorkspaceReaper.ts::workspaceGoTo#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'A round trip through the REAPER file bridge (under 3 s): Go to is busy and Loop meanwhile off (usePendingAction); where REAPER put the cursor is announced, and a refusal (the word was not heard, recording, an older script, REAPER gone) is an inline alert in plain words. The move itself stays in REAPER.'),
  'src/components/workspace/useWorkspaceReaper.ts::workspaceLoop#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'yes', 'ok', 'Loop is busy while REAPER sets the loop and plays; the window is announced and Stop loop appears, reading status.loopingFindingId (workspace:<chapterId>:...) rather than local state, so it is shown again after the narrator leaves and comes back. A refusal is an inline alert in plain words.'),
  'src/components/workspace/useWorkspaceReaper.ts::findingsStopLoop#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Stop loop is busy until REAPER has put back the time selection, loop points and repeat (shared with the Review page: one app loop at a time); a refusal is an inline alert and Stop stays offered.'),
  'src/components/workspace/useWorkspaceReaper.ts::workspaceGoTo#2': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Go to for a selected flag\'s word (FlagsPanel.tsx, Phase 4), not necessarily the playhead\'s: its own pending key (tokenPending) keeps it apart from the transport bar\'s row above, so pressing one never shows the other as busy. Same round trip, same inline refusal wording.'),
  'src/components/workspace/useWorkspaceReaper.ts::workspaceLoop#2': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'yes', 'ok', 'Loop for a selected flag\'s word (FlagsPanel.tsx, Phase 4): same as workspaceLoop#1, its own pending key (workspaceGoTo#2\'s tokenPending), and Stop loop above stops it exactly as it stops the transport bar\'s own loop (one app loop at a time, status.loopingFindingId survives navigation the same way).'),
};
