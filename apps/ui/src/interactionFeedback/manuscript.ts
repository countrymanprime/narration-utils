// The interaction feedback rows for the manuscript call sites (see interactionFeedback.catalog.ts for what a row says).
import { type FeedbackRow, row } from './row';

// prettier-ignore
export const manuscriptFeedback: Record<string, FeedbackRow> = {
  // Manuscript
  'src/components/manuscript/Manuscript.tsx::readerStateSave#1': row('effect', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'A small file write on every reader change; the reader has already moved.'),
  'src/components/manuscript/Manuscript.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'The page shows a load error with Retry (ADR 0069).'),
  'src/components/manuscript/Manuscript.tsx::guideEntities#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Loaded with the chapters: the page shows a load error with Retry.'),
  'src/components/manuscript/Manuscript.tsx::readerState#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Loaded with the chapters: the page shows a load error with Retry.'),
  'src/components/manuscript/Manuscript.tsx::noteList#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Loaded with the chapters: the page shows a load error with Retry.'),
  'src/components/manuscript/Manuscript.tsx::manuscriptParagraphs#1': row('effect', 'file-io', 'inline', 'na', 'ui', 'toast', 'na', 'ok', 'The chapter shows a loading state while its lines load.'),
  'src/components/manuscript/Manuscript.tsx::readerBookmarkDelete#1': row('click', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write.'),
  'src/components/manuscript/Manuscript.tsx::readerBookmarkCreate#1': row('click', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write.'),
  'src/components/manuscript/Manuscript.tsx::manuscriptSearch#1': row('input', 'file-io', 'none', 'na', 'ui', 'toast', 'na', 'ok', 'About 3 ms on a 90,000 word manuscript (docs/research/interaction-latency-baseline.md); a stale answer is dropped.'),
  'src/components/manuscript/Manuscript.tsx::noteCreate#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'A small file write.'),
  'src/components/manuscript/Manuscript.tsx::noteDelete#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'A small file write.'),
  'src/components/manuscript/Manuscript.tsx::guideCreate#1': row('click', 'python', 'pending', 'pending', 'ui', 'toast', 'no', 'ok', '"Add to Story Bible" shows the button busy while the entry is created (a Python process, about 0.6 s), ignores a second press and shows a failure (phase 3).'),
  'src/components/manuscript/Manuscript.tsx::readerBookmarkDelete#2': row('click', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write.'),
  'src/components/manuscript/useWordLookup.ts::systemLookup#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'toast', 'na', 'ok', 'Look up in the selection menu: a Go read of the dictionary index (about 1.5 ms; the first lookup of a session reads the index in full against its hash). The button is busy and the other selection actions are off meanwhile; the answer opens the panel; a failure is a toast and the selection stays.'),
  'src/components/manuscript/useWordLookup.ts::assetsInstall#1': row('click', 'download', 'dialog', 'host', 'dialog', 'dialog', 'no', 'ok', 'The dictionary download a lookup asked for, only after the narrator confirms the first-use question: the same flow as every other download (useAssetInstall), and the host joins a download that is already running. It ends by answering the lookup.'),
  'src/components/manuscript/useWordLookup.ts::assetsInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'The one install-poll loop (useAssetInstall): the dialog shows the bytes as they arrive and a failed poll in the dialog.'),
  'src/components/manuscript/useWordLookup.ts::assetsInstallCancel#1': row('click', 'download', 'dialog', 'dialog', 'dialog', 'dialog', 'no', 'ok', 'Cancel stops the download and the dialog says so; it is drawn only while bytes arrive.'),
  'src/components/manuscript/Manuscript.tsx::creditsTemplates#1': row(
    'mount',
    'file-io',
    'na',
    'na',
    'ui',
    'silent',
    'na',
    'exempt',
    'Loads the credits template library behind the Phase 3 Opening/Closing credits pseudo-entries (audiobook-credits-templates.prd.md); a failed load simply renders no credits entries rather than a toast over the manuscript itself, which already has its own load-error state for the chapters it cannot do without.',
  ),
  'src/components/manuscript/Manuscript.tsx::creditsRetailSample#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Reads the retail sample to mark its lines (Phase 5, ADR 0152); a failed read leaves the reader unmarked, and Settings > Credits shows the real error.'),
  'src/components/manuscript/Manuscript.tsx::creditsPreview#1': row(
    'effect',
    'instant',
    'na',
    'na',
    'ui',
    'inline',
    'na',
    'exempt',
    'Renders the first opening-kind template (ADR 0093\'s convention) with the current project values for the Opening credits entry; a failed render leaves that entry showing "Nothing to preview yet." (same fallback as CreditsPanel.tsx) rather than a toast.',
  ),
  'src/components/manuscript/Manuscript.tsx::creditsPreview#2': row(
    'effect',
    'instant',
    'na',
    'na',
    'ui',
    'inline',
    'na',
    'exempt',
    'Renders the first closing-kind template (ADR 0093\'s convention) with the current project values for the Closing credits entry; a failed render leaves that entry showing "Nothing to preview yet." rather than a toast.',
  ),

};
