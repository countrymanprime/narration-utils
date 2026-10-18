// The interaction feedback catalog (docs/architecture/interaction-feedback.md): one row for every place the UI calls the host, with a
// verdict against the standard. `interactionFeedback.test.ts` fails on a call site that has no row, on a row whose site is gone, and on a row that
// breaks the rules for its verdict, so the inventory cannot rot.
//
// A site is `<file under apps/ui>::<NarrationApi method>#<n>`, the n-th call of that method in that file, in source order. Adding or removing a call
// renumbers the ones after it in the same file; the test names the keys that changed.
//
// Adding a call to the host: write the call, then run `pnpm --dir apps/ui exec vitest run src/interactionFeedback.test.ts`; it names the missing
// key. Add the row: ask which tier the operation is in (measure it if it spawns Python) and give it the acknowledgment and guard that tier
// requires. An action that changes the Story Bible goes through `usePendingAction`; a control that starts something slow takes `pending`; a
// failure is `notify(describeApiError(error), 'error')`. A control that is not a `Button` or `IconButton` and needs a busy state gets the same
// three things: `aria-busy`, a press that does nothing, and focusability. The category `Menu` does not yet (#211). A new kind of background job
// is added in apps/desktop/jobs.go (see the comment on the job kinds).
import type { FeedbackRow } from './interactionFeedback/row';
import { appFeedback } from './interactionFeedback/app';
import { projectFeedback } from './interactionFeedback/project';
import { settingsFeedback } from './interactionFeedback/settings';
import { storyBibleFeedback } from './interactionFeedback/storyBible';
import { teleprompterFeedback } from './interactionFeedback/teleprompter';
import { engineFeedback } from './interactionFeedback/engine';
import { pickupsFeedback } from './interactionFeedback/pickups';
import { proofFeedback } from './interactionFeedback/proof';
import { editingFeedback } from './interactionFeedback/editing';
import { masterFeedback } from './interactionFeedback/master';
import { deliveryFeedback } from './interactionFeedback/delivery';
import { productionFeedback } from './interactionFeedback/production';
import { creditsFeedback } from './interactionFeedback/credits';
import { recordingFeedback } from './interactionFeedback/recording';
import { dawFeedback } from './interactionFeedback/daw';
import { extractionFeedback } from './interactionFeedback/extraction';
import { scriptFeedback } from './interactionFeedback/script';

export type { FeedbackRow } from './interactionFeedback/row';

// One file per area under interactionFeedback/ (the row shape and its helpers are interactionFeedback/row.ts). A site with a row
// in two areas fails here rather than one silently replacing the other.
const AREAS: Array<Record<string, FeedbackRow>> = [
  appFeedback,
  projectFeedback,
  settingsFeedback,
  storyBibleFeedback,
  teleprompterFeedback,
  engineFeedback,
  pickupsFeedback,
  proofFeedback,
  editingFeedback,
  masterFeedback,
  deliveryFeedback,
  productionFeedback,
  creditsFeedback,
  recordingFeedback,
  dawFeedback,
  extractionFeedback,
  scriptFeedback,
];

export const FEEDBACK_CATALOG: Record<string, FeedbackRow> = {};
for (const rows of AREAS) {
  for (const [site, row] of Object.entries(rows)) {
    if (Object.hasOwn(FEEDBACK_CATALOG, site)) throw new Error(`${site} has a row in two areas`);
    FEEDBACK_CATALOG[site] = row;
  }
}

/**
 * The bare catches (`catch {}`, `.catch(() => {})`, `.catch(() => undefined)`) that were reviewed and are safe, keyed `<file>#<n>` in source order, each with why.
 * The list may only shrink: a new one needs a reason a reviewer accepts, and a narrator's action never belongs here.
 */
export const SILENT_CATCHES: Record<string, string> = {
  'src/components/settings/page/BoothPanel.tsx#1':
    'The model list could not be read: nothing is claimed and no question is asked; Record looks the model up again before a take begins, so a missing model still stops there.',
  'src/api/uiLog.ts#1':
    'The trace line is best effort: a failed write of a log line must never become an error the narrator sees or the client reports again (it would loop).',
  'src/api/uiLog.ts#2': 'No host to write the trace line to (a test, the mock client): the call is a no-op there, never an error.',
  'src/components/schedule/SchedulePage.tsx#1':
    'Keeps the write queue going after a change failed: the change already showed its refusal in a toast, and this catch only stops the failure from holding up the next write.',
  'src/components/project/NewProjectDialog.tsx#1':
    'Reads the default projects folder only to show it; unreadable, the dialog names it in words, and Create still sends an empty parent the host resolves (and refuses with its own reason).',
  'src/components/proof/checkcard/CheckCard.tsx#1':
    'Seeds the card with the run in progress; a failed seed leaves the card on the stored result until the next coverage:state event.',
  'src/components/production/ChapterTrackPanel.tsx#1':
    'onRemoveFromRecording already shows the failure (its own toast, in useChapterTools) before rethrowing; this catch only stops that rejection from going unhandled and skips closing the confirm, so the narrator can retry.',
  'src/api/wailsClient.ts#1': 'The diagnostic report itself: a report that fails must not raise a second error over the one being reported.',
  'src/api/wailsClient.ts#2': 'The host binding is missing (not running inside the desktop app), so there is nothing to report to.',
  'src/App.tsx#1':
    "The header's running-timer chip on first load: an unreadable overview just leaves the chip hidden until the Production home reads one and says why there.",
  'src/App.tsx#2': 'A diagnostic report while showing the startup error; it must not throw over it.',
  'src/App.tsx#3': 'The window error handler reports a diagnostic; a failing report must not raise another window error.',
  'src/App.tsx#4': 'The unhandled-rejection handler reports a diagnostic; a failing report must not raise another rejection.',
  'src/App.tsx#5': "Cosmetic: the narrator's entity colours. The built-in colours stay if the settings cannot be read, and Settings reports the real error.",
  'src/components/storybible/entryList.ts#1':
    "Saving the Story Bible list's sort choice to localStorage: with storage unavailable the choice lasts until the page closes, and the list is already sorted as asked.",
  'src/hooks/useChapterSync.ts#1':
    "Seeds useChapterSync's state before the next chaptersync:state event; a failed seed just leaves the state undefined a moment longer.",
  'src/useCapability.ts#1':
    "Seeds useCapability's entry before the next daw_capabilities_changed event; a failed seed just leaves the capability unsupported/unavailable a moment longer, same as an unknown capability key.",
  'src/useDawKind.ts#1':
    "Seeds useDawKind's kind before the next daw_capabilities_changed event; a failed seed just leaves the kind unknown a moment longer, the same as before the first answer, so a caller gating on 'Audacity' keeps today's REAPER-shaped behaviour rather than guessing.",
  // useZoom's three call sites, none of which has anywhere better to send a failure -
  // the header's readout is the only surface, and every one leaves the level exactly where it was, corrected by the next resize.
  'src/input/useUserKeymap.ts#1':
    "A malformed Keymap.overrides document falls back to the catalogue defaults, so the keys shown and fired are the defaults; Settings' Keyboard panel is where the narrator sees and resets them.",
  'src/input/useUserKeymap.ts#2':
    "Reads the narrator's remaps for the sheet and the router; unreadable, the defaults stay, and Settings reports the real error.",
  'src/hooks/useZoom.ts#1': 'The initial read on mount; a failure just leaves the readout at its 100% default until the next resize re-reads it.',
  'src/hooks/useZoom.ts#2':
    'A button/shortcut set (zoomIn, zoomOut, reset); a failure leaves the readout at the level before the click, which the narrator can see and try again.',
  'src/hooks/useZoom.ts#3':
    'The resize-triggered re-read (Ctrl+wheel/pinch outside this hook); a failure just leaves the readout at its last known level until the next resize.',
  // the debounced persistence write, added after the three above.
  'src/hooks/useZoom.ts#4':
    'The debounced persist of the settled level; a failure just leaves the next launch opening at the last successfully saved level, and the narrator sees no error from a header control that already did what they asked.',
  'src/components/production/report/ReportDialog.tsx#1':
    'Only decides whether the dialog offers the amount line; without the plan the line is left off and the report itself reports its own errors.',
  'src/components/proof/frame/WaveformWindow.tsx#1':
    'Pointer capture is not available in every environment; the overview still follows the pointer events it gets without it.',
  'src/components/proof/frame/WaveformWindow.tsx#2':
    'Pointer capture is not available in every environment; the edge handle still follows the pointer events it gets without it.',
  'src/studio/commands/bookmarks.ts#1': 'Reloads the bookmarks slot after a change; the store records a failed load and the change that was made stands.',
  'src/App.tsx#6':
    "The jump menu's chapter list (the store's chapters slot): a failed read keeps the last list, every page still shows, and the pages that need the chapters report the real error.",
  'src/App.tsx#7': 'Best effort recovery for a popstate the app did not start: a reset that fails leaves the finished results in place, which is harmless.',
  'src/App.tsx#8':
    'Best effort when leaving a Proof chapter view with a compare run through the nav: a reset that fails leaves the finished results in place, which is harmless.',
  'src/App.tsx#9': 'Best effort when leaving a Proof chapter view with a compare run through guarded Back/Forward: same as the nav, harmless either way.',
  'src/components/production/ManuscriptImport.tsx#1':
    'Only pre-fills the "Build the Story Bible after import" checkbox from Settings; it keeps its on-by-default local state without it, and the narrator can still change it per import.',
  'src/components/proof/CompareRun.tsx#1': 'Reads the last model and chunk choice; the defaults stay usable and Settings reports a real error.',
  'src/components/proof/CompareRun.tsx#2':
    'The "may have changed since comparison" background check: comparing a successful REAPER answer against the baseline is best-effort - a failure just leaves the note as it was, tried again next low-frequency poll.',
  'src/components/proof/CompareRun.tsx#3':
    "The same background check's REAPER round trip: a failed ask (REAPER closed, no bridge) is routine while results sit reviewed, not a narrator-facing failure, so it is silent and retried next poll.",
  'src/components/proof/NativeTakesPanel.tsx#1':
    "The panel's first read of the chapter's native takes; a failure just leaves it unrendered a moment longer until the next recording:state event (subscribeRecorderState) catches up, the same fallback useRecorder.ts::recorderState#2 already uses.",
  'src/components/booth/CompanionShell.tsx#1':
    "Companion mode's exit on unmount: nothing is left mounted to tell, and the host's exit is a no-op when companion mode was never entered, so there is no state it could leave wrong that a retry would fix.",
  'src/components/booth/listening/useListeningMic.ts#1':
    'Asking the DAW which microphone it records with, only to preselect it: a failed ask leaves the choice to the narrator in Levels, exactly as an answer that is not a sure match does.',
  'src/components/booth/useRecorder.ts#1': "Only the engine chip's first reading; without it the chip stays on REAPER until the next recording:state.",
  'src/components/booth/useTeleprompterSession.ts#1':
    'Clearing the migrated browser-storage device once it is written to settings; if storage cannot be reached the stale value is simply left behind and never read again (the settings value now wins).',
  'src/components/booth/useTeleprompterSession.ts#2': 'Hydrates a session that was already running; the state event follows anyway.',
  'src/components/booth/useTeleprompterSession.ts#3':
    'The one-time browser-storage-to-settings migration write; a failure leaves the device in local state for this visit and the migration is retried next load since the settings value never got marked set.',
  'src/components/masterqc/page/sharedChapter.ts#1':
    'Remembering the chapter Master & QC is on, under the key Proof reads, in localStorage; with storage unavailable the choice lasts for this visit only.',
  'src/components/proof/ProofPage.tsx#1':
    'Reading the last chapter looked at on Proof per project from localStorage; with storage unavailable a step from All chapters opens the first chapter.',
  'src/components/proof/useChapterTimeline.ts#1':
    "The chapter's alignment only names which peaks belong to which item; a chapter not aligned yet draws flat lines in the waveform window.",
  'src/components/script/scriptPageHost.ts#1':
    'Renders the opening credits card preview; a failed render leaves that card without one rather than a toast over the manuscript.',
  'src/components/script/scriptPageHost.ts#2': 'Renders the closing credits card preview; same fallback as the opening one above.',
  'src/components/script/scriptPageHost.ts#3':
    "Reading the Words tab's old per-viewer definition source from localStorage, once, to move it to the host setting; with storage blocked there is nothing to move and the host's setting is used.",
  'src/components/script/scriptPageHost.ts#4':
    "Reading Script.definition_source for the Words tab's source menu (or moving the old localStorage choice into it); a failed read keeps the source the menu shows, and the next window focus reads again. A choice the narrator makes has its own toast on failure.",
  'src/components/script/page/reader/readerPosition.ts#1':
    'Remembering where the Script reader was in localStorage; with storage blocked or full the page opens at the top of the chapter next time, and the reader still scrolls as asked.',
  'src/components/booth/page/useTextChoices.ts#1':
    "Remembering the Booth's text size in localStorage; with storage blocked or full the size lasts for this visit and the next one opens at 40 px.",
  'src/components/script/page/tools/text/readerText.ts#1':
    'Per-viewer reading choices in localStorage (the booth rail does the same): storage can be blocked or full, and the page then keeps the choice for the session and reads with the defaults.',
  'src/theme/ThemeContext.tsx#1': 'Remembering the theme in localStorage; the preference just does not persist when storage is disabled.',
  'src/components/engine/EnginePanel.tsx#1':
    'Only decides whether the "Link chapters…" tool shows; without it the button is absent, same as a project with no chapters.',
  'src/components/engine/EnginePanel.tsx#2':
    'Only names each track\'s chapter in the engine panel\'s track list; without it the column reads "Not linked", and the Chapter links table under it reports its own read failure.',
  'src/components/engine/LinkChaptersDialog.tsx#1':
    'Hydrates whatever stamp or read was already in flight when the dialog reopened; the live event follows anyway.',
  'src/components/pickups/usePickupsState.ts#1':
    'Hydrates whatever run was already in flight, then refreshes the count; a failure here leaves the count at its last known value, and every narrator-triggered action still shows its own failure inline.',
  'src/components/proof/inspector/useShownEvidence.ts#1':
    'Re-reads a finding after the host refused a decision, only to tell changed evidence apart; when the re-read fails too, the inline alert still shows the host reason for the refusal, so nothing is hidden (the same reading the Proof Inspector makes).',
  'src/components/editing/EditingCheckPanel.tsx#1':
    "Reads the chapter's stored analysis-source choice on open; a failed read just leaves the default (items) selected, which is already correct for a chapter with no choice made yet, so there is nothing to guard or retry.",
  'src/components/engine/RetakeLanesDialog.tsx#1':
    'Hydrates whatever pick was already in flight when the dialog reopened; the list still loads and every pick shows its own failure inline.',
  'src/components/engine/CleanupToolsDialog.tsx#1':
    'Hydrates whatever launch was already in flight when the dialog reopened; the narrator can press Open either way, and a launch shows its own failure inline.',
  'src/components/engine/RenderConfigDialog.tsx#1':
    'Hydrates whatever configure run was already in flight, then offers a suggested output folder when none was configured yet; the narrator can still type a folder and press Configure render either way.',
  'src/components/production/RecordingCheckReport.tsx#1':
    "A background count of the chapter's other pickups; a failure just leaves that line out of the Pickups list, with the check's own gaps unaffected.",
  'src/input/keymap.ts#1':
    "keymapFromBindings: one stored gesture this build cannot parse (a hand-edited settings file, or an older/newer app's own bug) falls back to that one command's catalog default; not a narrator action, and not swallowed silently since the Keyboard & pedals panel still shows every other override normally.",
  'src/components/engine/CreateChapterRegionsDialog.tsx#1':
    'Refreshes the preview right after a successful create, so the table shows the just-written rows as "exists"; the created counts already shown answer whether the write worked, so a failed refresh only leaves the pre-create preview in place.',
  'src/input/MidiSource.ts#1':
    'requestMIDIAccess() rejecting (denied, unsupported, or blocked by the webview host): not a narrator action to retry, and not swallowed silently since KeyboardSource keeps every keyboard-type pedal working; MidiSource just contributes nothing rather than surfacing an error nobody in the booth can act on.',
  'src/input/HidSource.ts#1':
    'device.open() rejecting for an already-granted device (OS denial, or unplugged mid-open): retried on the next attach, and not swallowed silently since KeyboardSource and MidiSource keep every other pedal working; this device just contributes nothing until it opens.',
  'src/input/HidSource.ts#2':
    'navigator.hid.getDevices() rejecting (an unsupported or torn-down navigator.hid): leaves this source with no devices; KeyboardSource and MidiSource still cover the booth, so it just contributes nothing rather than surfacing an error nobody can act on.',
  'src/input/HidSource.ts#3':
    "requestHidDevice()'s chooser promise rejecting (the narrator cancelled it, or, plausibly on WebView2, no chooser ever appeared): not a narrator action to retry automatically, and the only outcome either way is that no new device got paired this time.",
  'src/components/booth/ResumePrompt.tsx#1':
    "Starts the bounded REAPER follow for the matched track while the prompt shows; a failure to start just means that poll never begins, and the DAW-transport subscription and the narrator's own choices still settle the prompt.",
  'src/components/booth/ResumePrompt.tsx#2':
    'Stops the follow on cleanup (the prompt settles, a session starts, or the dialog closes); a failure here is unobservable and harmless, since the poll it would have stopped already lost its listener.',
  'src/components/proof/ProofChapterPage.tsx#1': 'Only offers to review the last compare run; without it the offer is absent (moved from the Proofing page).',
  'src/components/booth/companion/CompanionHost.tsx#1':
    'Keeps the suspected-line flags as the session ends; a failed save leaves them to be found again by the next check.',
  'src/components/booth/companion/CompanionPage.tsx#1': 'The last-read chapter only picks the default chapter; the first chapter is used without it.',
  'src/components/booth/companion/CompanionPage.tsx#2': 'The running session only picks the default chapter; the last-read chapter is used without it.',
  'src/components/booth/companion/CompanionPage.tsx#3': 'The credits templates only decide whether the credits panel shows; with none, it stays absent.',
  'src/components/booth/frame/useLevels.ts#1':
    'Releases the meter-only child on cleanup; nothing is left mounted to tell, and the next start works either way.',
  // The new Booth page (SN-O102): secondary reads that only add to a chapter that already reads.
  'src/components/booth/page/useBoothData.ts#1': 'The credits templates only decide whether the picker offers the credits; with none, it offers the chapters.',
  'src/components/booth/page/useBoothData.ts#2': 'The running session only picks the default chapter; the first chapter is used without it.',
  'src/components/booth/page/useBoothData.ts#3': 'The Story Bible entries only tint names and fill the side panel; without them the chapter reads unmarked.',
  'src/components/booth/page/useBoothData.ts#4': 'The dialogue cues only add speaker chips; without them every phrase reads as narration.',
  'src/components/booth/page/useBoothPage.ts#1':
    'The resume lookup only offers where the recording ends; a failure offers nothing and Record still starts at the end of the last item.',
};
