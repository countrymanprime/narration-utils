import { DAW_CHOICE_MOCK_SEEDS, type DawChoiceMockName } from './api/dawChoiceMock';
import { DAW_MOCK_SCRIPTS, type DawMockControl, type DawMockSeed } from './api/dawMock';
import { BOOTH_STRESS, MIC_STRESS, boothStressSeed, micStressDevices } from './fixtures/boothStress';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { wailsClient } from './api/wailsClient';
import { enableUiLog } from './api/uiLog';
import type { RecordingMockSeed } from './api/recordingMock';
import { createMockApi } from './api/mockApi';
import { scenarioFromToday } from './api/productionMock';
import { MOCK_FIDELITY, mockFidelityFrom } from './api/mockHost/mockFidelity';
import { WIRE_CHAPTERS, WIRE_FINDINGS, WIRE_TRACKS_PROJECT, editingCandidateFor, takeReviewPickupFor } from './api/mockFixtures';
import { COVERAGE_REFUSAL_REASONS } from './api/schemas/coverage';
import { EDITING_REFUSAL_REASONS } from './api/schemas/editing';
import type { StageUnknownCause } from './api/contracts/stages';
import type { PreviewCandidate } from './api/contracts/preview';
import { MOCK_RESUME_SEEDS } from './api/resumeMockSeed';
import { MOCK_REAPER_INPUT_SEEDS, MOCK_REAPER_SEEDS } from './api/teleprompterMock';
import { scenarioFromParams } from './components/devtools/mockStates';
import { ThemeProvider } from './theme/ThemeContext';
import { LiveCommandRouter } from './input/LiveCommandRouter';
import { createKeyboardSource } from './input/KeyboardSource';
import { combineSources, midiSource } from './input/MidiSource';
import { hidSource } from './input/HidSource';
import './fonts';
import './styles.css';

// docs/architecture/studio-shell-and-registries.md: the router's one `source` slot carries KeyboardSource, MidiSource and HidSource. Built once, here, so
// `router.tsx` never needs to know MIDI or HID exist.
const commandInputSource = combineSources(createKeyboardSource(), midiSource, hidSource);

// Mock mode runs the complete UI in a browser without the desktop host.
//
// Visual tests set mock overrides before the app starts.
declare global {
  interface Window {
    __NARRATION_MOCK_OVERRIDES__?: Parameters<typeof createMockApi>[0];
    __NARRATION_MOCK_DAW__?: DawMockControl;
    /** The mock microphone's side: unplug it mid-session (teleprompterMock.ts). */
    __NARRATION_MOCK_TELEPROMPTER__?: { failListening: (message: string) => void };
  }
}
// Production is a native Wails window. Browser use is supported only through
// the explicit mock mode used by UI tests; no loopback HTTP host exists.
// `?mockNoProject=1` boots straight into ProjectPicker (no project folder
// attached yet) - a URL param rather than a window global so a Playwright
// driver can reach it with a plain second `page.goto`, no init-script
// plumbing needed before the app's first render.
// `?mockMultipleRpp=1` seeds two .rpp candidates so the audio engine panel shows
// its choose-a-project-file prompt instead of auto-selecting the only one.
const mockParams = new URLSearchParams(window.location.search);
const mockNoProject = mockParams.has('mockNoProject');
const mockMultipleRpp = mockParams.has('mockMultipleRpp');
// `?mockNoRpp=1` seeds zero candidates: the project folder has no .rpp file.
const mockNoRpp = mockParams.has('mockNoRpp');
// `?mockNoDaw=1` boots a project with no linked REAPER project (.rpp) file: the header pill reads "No REAPER project
// linked", Proofing's nav item/Home card/Start are gated, and
// Tracks/Settings show their unlinked DAW-link controls. The mock otherwise defaults `dawFileLinked` to true so every
// other capture (and App.test.tsx's default click into Proofing) keeps working without this param.
const mockNoDaw = mockParams.has('mockNoDaw');
// `?mockDawMismatch=1` simulates a live REAPER heartbeat whose open project disagrees with the linked file:
// the engine chip reads "Wrong REAPER project open".
const mockDawMismatch = mockParams.has('mockDawMismatch');
// `?mockDawNotDetected=1` makes the DAW catalog panel (Settings > DAW Integration, docs/architecture/
// daw-integration.md) report REAPER as not detected, so its "Get REAPER" button can be seen without a host.
const mockDawNotDetected = mockParams.has('mockDawNotDetected');
// `?mockDawExperimentalOn=1` turns every Experimental DAW capability on (the old `DAW.experimental_reaper_actions`
// setting's own effect), so a `CapabilityGate('item_gain')` control's live,
// clickable state can be seen without a host - it still carries the "Experimental" badge.
const mockDawExperimentalOn = mockParams.has('mockDawExperimentalOn');
// `?mockDaw=Audacity` boots the app talking to Audacity instead of REAPER: Proof's finding detail
// leaves out REAPER's take management (Go to/Loop/Add marker, take review, take comparison), which has no
// Audacity analog, while everything else about a finding works the same.
const mockDawAudacity = mockParams.get('mockDaw') === 'Audacity';
// `?mockDaw=live|late|quiet|different|refuse|restart` boots a fresh machine (REAPER not connected, no project file linked) with a mock DAW that
// moves like the host's: linking, the launcher, a saved setting, the engine choice, a heartbeat and a take each change what the Booth sees. The
// value is what REAPER does once the app starts it (dawMock.ts). A Playwright driver plays the rest through window.__NARRATION_MOCK_DAW__.
const mockDawScriptParam = mockParams.get('mockDaw');
const mockDawScript = DAW_MOCK_SCRIPTS.find((script) => script === mockDawScriptParam);
// `?mockDawChoice=found|several|linked|not-running|not-installed` seeds the project's DAW choice (dawChoiceMock.ts) and, for every
// one, a REAPER that is not answering: Settings > Recording's link and start rows and the Booth chip's states, without a host.
const mockDawChoiceName = mockParams.get('mockDawChoice');
const mockDawChoice = mockDawChoiceName && mockDawChoiceName in DAW_CHOICE_MOCK_SEEDS ? (mockDawChoiceName as DawChoiceMockName) : undefined;
// `?mockCreditsMissing=1` drops the closing credit templates: Home's chapter table shows the
// Closing credits row as "Not set up" with a link to Settings > Credits.
const mockCreditsMissing = mockParams.has('mockCreditsMissing');
// `?mockNoManuscript=1` boots a project with no manuscript imported yet, so
// Home shows its manuscript-not-found banner and Proofing/Story Bible are locked.
const mockNoManuscript = mockParams.has('mockNoManuscript');
// `?mockPickupList=unreadable` makes every read of the Pickups list fail, to see the page's reason and Check again without a host.
const mockPickupList = mockParams.get('mockPickupList') === 'unreadable' ? ('unreadable' as const) : undefined;
// `?mockManuscriptCandidate=1` boots a project with no imported manuscript but a
// manuscript.docx in its folder, so Home shows the import offer.
const mockManuscriptCandidate = mockParams.has('mockManuscriptCandidate');
// `?mockManuscript=mixed` adds a buttonless Front Matter row and a 5-digit word count to the Manuscript page's chapter
// list, so the header's aligned stat block and action slot can be seen across a mix of row shapes,
// plus four of the owner's chapter-heading shapes - source capitals
// with a subtitle, no subtitle, a long subtitle, and a title already ending in a colon - so a chapter's name reads
// the same way everywhere it is drawn.
const mockManuscriptMixed = mockParams.get('mockManuscript') === 'mixed';
// `?mockTeleprompter=listening|waiting|done|flagged` boots the teleprompter already part-way
// through the first chapter, as a session the host kept running (`flagged`: further in, with suspected flags raised);
// `ended` boots one that already stopped itself at the end of the chapter (the host's auto-stop).
const mockTeleprompter = (['listening', 'waiting', 'done', 'ended', 'flagged'] as const).find((seed) => seed === mockParams.get('mockTeleprompter'));
// `?mockLevel=-18` makes every microphone level the teleprompter mock sends that RMS in dBFS (-100 to 0), so the level meter
// holds still for a capture.
const mockLevelParam = Number(mockParams.get('mockLevel') ?? Number.NaN);
const mockLevel = Number.isFinite(mockLevelParam) && mockLevelParam >= -100 && mockLevelParam <= 0 ? mockLevelParam : undefined;
// `?mockZoom=125` boots the header's zoom group already at that percentage, so the visual
// suite can capture a non-100% level without driving Ctrl+wheel or a button click first.
const mockZoomParam = Number(mockParams.get('mockZoom') ?? Number.NaN);
const mockZoom = Number.isFinite(mockZoomParam) && mockZoomParam > 0 ? mockZoomParam / 100 : undefined;
// `?mockReaperState=ready|not_armed|other_armed|several_armed|no_link|recording_elsewhere|unavailable|experimental_off` makes
// the read-aloud dialog's REAPER state answer that for every chapter.
const mockReaperState = MOCK_REAPER_SEEDS.find((seed) => seed === mockParams.get('mockReaperState'));
// `?mockReaperInput=matched|uncertain|no_match|reaper_no_device|experimental_off` makes the microphone REAPER records from
// answer that.
const mockReaperInput = MOCK_REAPER_INPUT_SEEDS.find((seed) => seed === mockParams.get('mockReaperInput'));
// `?mockResume=agree|disagree|prompter_only|low_confidence|complete|not_found|ambiguous|none|no_recording|source_missing|source_unsupported|error`
// makes the read-aloud dialog's resume prompt show that state for any chapter,
// so each can be seen without a REAPER project, a recording or a Whisper run.
const mockResume = MOCK_RESUME_SEEDS.find((seed) => seed === mockParams.get('mockResume'));
// `?mockRemoved=1`: the last narration chapter boots removed from recording.
const mockRemoved = mockParams.get('mockRemoved') === '1';
// `?mockChapterSync=ask|off|linked|unsaved|pickups|activity|background`: chapter sync's consent at boot
// (`unsaved` is REAPER holding unsaved edits, with a Sync activity row; `pickups` is a chapter whose pickup track changed since its last scan; `activity` is the engine
// panel's Sync activity with an automatic and a manual link; `background` is a background check waiting because the
// heartbeat says REAPER is recording).
const mockChapterSync = (['ask', 'off', 'linked', 'unsaved', 'pickups', 'activity', 'background'] as const).find(
  (seed) => seed === mockParams.get('mockChapterSync'),
);
// `?mockBooth=huge-chapter|many-chapters|emoji|rtl|odd-titles` replaces the manuscript with the Booth's worst cases (fixtures/boothStress.ts): a
// 100,000-word chapter, 5000 chapters, all-emoji, right-to-left and hostile titles and text. `?mockMics=0|1|50|weird|long` lists that many microphones,
// or ones with quotes, newlines, right-to-left text and emoji in their names, to the teleprompter and the built-in recorder.
const mockBoothStress = BOOTH_STRESS.find((name) => name === mockParams.get('mockBooth'));
const mockMicsStress = MIC_STRESS.find((name) => name === mockParams.get('mockMics'));
// `?mockNoDevices=1` boots the teleprompter with an empty device listing, so the
// blocked "No microphone found" state (no typed fallback) can be seen without a host.
const mockNoDevices = mockParams.has('mockNoDevices');
// `?mockCredits=filled` boots the project with its credits values set (title, author, narrator), so the credits read on the
// teleprompter with every token resolved can be seen without saving them in Settings first.
// `?mockCredits=extras` does that too and adds a chapter announcement template and a retail sample on lines 1-3 of
// Chapter 3, so the announcement preview and the sample marker can be seen without picking them.
const mockCreditsExtras = mockParams.get('mockCredits') === 'extras';
const mockCreditsFilled = mockParams.get('mockCredits') === 'filled' || mockCreditsExtras;
// `?mockCredits=detected` widens the manuscript-detected candidates past Title/Author to every token the front matter
// parser can find - Year, Copyright holder, a low-confidence Publisher - so Settings > Credits' per-field source
// caption can be seen on every field.
const mockCreditsDetected = mockParams.get('mockCredits') === 'detected';
// `?mockCredits=setup`: the project has no credits values and its setup prompt has not been answered, so Home asks.
const mockCreditsSetup = mockParams.get('mockCredits') === 'setup' || mockParams.get('mockCredits') === 'setup-narrator-default';
// `?mockCredits=setup-narrator-default`: as `setup`, but the narrator token already has a value, so the prompt asks
// for only Title and Author - the state a returning narrator with a saved default sees.
const mockCreditsSetupNarratorDefault = mockParams.get('mockCredits') === 'setup-narrator-default';
// `?mockPreviewError=<text>` makes the Story Bible preview fail with that text once the
// preview voice is installed, so the failure toast can be seen without a real host.
const mockPreviewError = mockParams.get('mockPreviewError');
// `?mockPreviewCandidates=no-manuscript|nothing-eligible|computing|shorter|warnings|pinned|pin-stale` forces the
// Proof chapter view's Preview panel into a named state the unseeded
// demo book (the full Alice's Adventures in Wonderland text, aliceManuscript.ts) wouldn't otherwise reach on its own - every chapter there is long enough to hit the target
// length cleanly, so the plain default state has no warnings at all: `no-manuscript`/`nothing-eligible` force
// PreviewApi's outcome directly (the route itself already redirects away with no manuscript at all, so this is
// the only way to see that defensive state on the real page); `computing` never resolves the read; `shorter` and
// `warnings` each seed one hand-built candidate (the engine's two warning texts, `preview.reasonsFor` and
// `wholeChapterCandidate`) rather than a real short or unclassified chapter, so their paragraph ids are
// illustrative only - opening one in the reader or copying its range lands on the chapter's first paragraph
// rather than the exact seeded range. `pinned` and `pin-stale` seed a narrator pin on the first
// chapter's real paragraphs alongside the normal default candidates, the second with a `text_changed` staleness.
const mockPreviewCandidatesParam = (['no-manuscript', 'nothing-eligible', 'computing', 'shorter', 'warnings', 'pinned', 'pin-stale'] as const).find(
  (seed) => seed === mockParams.get('mockPreviewCandidates'),
);
// `pinned` and `pin-stale` seed a narrator pin on the demo book's first chapter alongside the normal
// default candidates, so the pinned section can be captured with and without its stale banner.
const MOCK_PREVIEW_PIN_CHAPTER = WIRE_CHAPTERS[0];
const MOCK_PREVIEW_PIN_PARAGRAPH_IDS = (MOCK_PREVIEW_PIN_CHAPTER.paragraphIds ?? []).map((paragraph) => paragraph.id);
const MOCK_PREVIEW_SHORTER_CANDIDATE: PreviewCandidate = {
  chapterId: WIRE_CHAPTERS[10].id,
  chapterTitle: WIRE_CHAPTERS[10].title,
  paragraphIds: (WIRE_CHAPTERS[10].paragraphIds ?? []).map((paragraph) => paragraph.id),
  wordCount: 210,
  estimatedSeconds: 81,
  shorter: true,
  reasons: ['Mostly narration, little or no dialogue.', 'No Story Bible entities mentioned in this range.', 'Starts and ends on paragraph boundaries.'],
  warnings: ['This chapter is shorter than the target length even in full.'],
};
const MOCK_PREVIEW_WARNING_CANDIDATE: PreviewCandidate = {
  chapterId: WIRE_CHAPTERS[1].id,
  chapterTitle: WIRE_CHAPTERS[1].title,
  paragraphIds: (WIRE_CHAPTERS[1].paragraphIds ?? []).map((paragraph) => paragraph.id),
  wordCount: 780,
  estimatedSeconds: 305,
  shorter: false,
  reasons: ['Mixes narration and dialogue (50% of paragraphs have dialogue).', 'One Story Bible entity present.', 'Starts and ends on paragraph boundaries.'],
  warnings: ['This manuscript was imported before chapters were classified narration, opening or reference; treated as narration.'],
};
// `?mockInvalidPayload=bootstrap|manuscript|storybible` makes that payload arrive in the wrong shape (through the real `parseWire`),
// so the startup error screen and the inline page errors for a payload the app could not read can be seen without a host.
const mockInvalidPayload = (['bootstrap', 'manuscript', 'storybible'] as const).find((which) => which === mockParams.get('mockInvalidPayload'));
// `?mockLiveDegraded=1` tells the app at once that live updates are degraded, so the notice can be seen without a failing host.
const mockLiveDegraded = mockParams.has('mockLiveDegraded');
// `?mockRebuildRunning=1` boots with a Story Bible rebuild still running, so its dialog can be seen without a host.
const mockRebuildRunning = mockParams.has('mockRebuildRunning');
// `?mockBuild=hold|fails` makes the next Story Bible build stay running, or fail at its first poll, so the build chained after an import
// can be seen running and failing without a host.
const mockBuild = (['hold', 'fails'] as const).find((seed) => seed === mockParams.get('mockBuild'));
// `?mockHoldEdits=1` makes every Story Bible edit hang, so the busy Save button can be seen without a host.
const mockHoldEdits = mockParams.has('mockHoldEdits');
// `?mockUpdate=available|found|downloading|download-fails|ready|install-blocked|install-refused|failed|current|development` boots the mock host in that update state ("Version 0.2.7 is available", "could not reach
// GitHub", "up to date", a development build), so the About and updates page can be seen without GitHub. `found` also notifies at once.
const mockUpdate = (
  ['available', 'found', 'downloading', 'download-fails', 'ready', 'install-blocked', 'install-refused', 'failed', 'current', 'development'] as const
).find((seed) => seed === mockParams.get('mockUpdate'));
// `?mockAssets=missing|downloading|verifying|download-fails` boots without the voice, model and language model installed (so the first-use questions show) and makes the next voice or model download hold at 40 percent, hold at the check, or fail after 40
// percent, so the download dialogs can be seen without a host or a 114 MB transfer. Unset, a download runs through its steps to the end.
// `installing|checking|damaged` are for Settings > Local assets: they boot with the Whisper model and the language model installed, and
// `installing` / `checking` with the voice download already running (held at 40 percent, or at the check), `damaged` with the Whisper model failing its check.
const mockAssets = (['missing', 'downloading', 'verifying', 'download-fails', 'installing', 'checking', 'damaged'] as const).find(
  (seed) => seed === mockParams.get('mockAssets'),
);
// `?mockSeries=not-in-series|single-book` boots the Series tab outside any
// series, or in one with no other book yet, so its honest empty state can be seen. Unset boots as a member of a two-book
// series (WIRE_SERIES), matching the approved concept mock.
const mockSeries = (['not-in-series', 'single-book'] as const).find((seed) => seed === mockParams.get('mockSeries'));
// `?mockDictionary=missing|damaged` boots without the offline dictionary, or with one whose index fails its check, so the reader's Look up asks to
// download it (or to download it again) first.
const mockDictionary = (['missing', 'damaged'] as const).find((seed) => seed === mockParams.get('mockDictionary'));
// `?mockImportPreview=markdown|repaired|text` makes the next manuscript import a Markdown file (so the chapter heading level choice can be seen in the review dialog), a
// Word file whose headings the importer had to repair (so the repairs note can), or a plain-text file with an epigraph read as a subtitle (so a subtitle
// that returns to the text when it is turned off can).
const mockImportPreview = (['markdown', 'repaired', 'text'] as const).find((kind) => kind === mockParams.get('mockImportPreview'));
// `?mockChapterLink=none|missing|ambiguous|confirmed` seeds the first chapter's mapping directly, so a track-link state
// that would otherwise need a real REAPER round trip (or several link/relink clicks) can be seen on load: `none` links no chapter to a track (the
// state of a chapter whose stage says recorded but whose track was never linked: Editing says there is no audio to edit, Proof no recording to
// check); `missing` confirms a track GUID that is not in the mock REAPER project (the audio engine panel's "Track missing" state);
// `ambiguous` confirms it to two tracks at once; `confirmed` links it to its own suggested "Chapter 1" track outright, without a Change/Confirm
// click. Unset is `confirmed` (see `chapterLink` below): the mock project has a track for Chapter 1 and its stages call that chapter recorded, so
// the assembled mock agrees with itself (Production, Editing and Proof all say Chapter 1 is recorded) and Editing opens on a take.
const mockChapterLinkSeed = (['none', 'missing', 'ambiguous', 'confirmed'] as const).find((seed) => seed === mockParams.get('mockChapterLink'));
// `?mockLineIdentity=success|conflict|error` boots the audio engine panel's "Link chapters" dialog with LineIdentityState already at that
// result, so its stale/conflict/drift and error states can be seen without a real REAPER round trip.
const mockLineIdentity = (['success', 'conflict', 'error'] as const).find((seed) => seed === mockParams.get('mockLineIdentity'));
// `?mockPickups=import-success|next-success|export-success|error` boots the Pickups page (and the Booth companion's
// Pickups section) with PickupsState already at that result, so the remaining-count, next and export states can be seen without a real
// REAPER round trip.
const mockPickups = (['import-success', 'next-success', 'export-success', 'error'] as const).find((seed) => seed === mockParams.get('mockPickups'));
// `?mockRenderConfig=success|no-regions|error` boots the audio engine panel's "Prepare chapter render" dialog with
// RenderConfigState already at that result, so the confirmed-file-names, no-regions-yet and error states can be
// seen without a real REAPER round trip.
const mockRenderConfig = (['success', 'no-regions', 'error'] as const).find((seed) => seed === mockParams.get('mockRenderConfig'));
// `?mockCleanupTools=launched|error` boots the audio engine panel's "Cleanup tools" dialog with CleanupToolsState already at
// that result (error: Magnolius DeClick not installed), so both can be seen without a real REAPER round trip.
const mockCleanupTools = (['launched', 'error'] as const).find((seed) => seed === mockParams.get('mockCleanupTools'));
// `?mockRetakeLanes=picked|error|none` boots the audio engine panel's "Retakes on lanes" dialog at that result (none: a project
// with no fixed-lane track), so each can be seen without a real REAPER round trip.
const mockRetakeLanes = (['picked', 'error', 'none'] as const).find((seed) => seed === mockParams.get('mockRetakeLanes'));
// `?mockChapterTags=ready|not-rendered` boots the audio engine panel's "Embed chapter tags" dialog with ChapterTagsPreview
// already at that result, so the ready and not-yet-rendered states can be seen without a real chapter render.
// `?mockChapterTagsEmbedError=1` makes the embed action always fail, so the error state can be seen too.
const mockChapterTags = (['ready', 'not-rendered'] as const).find((seed) => seed === mockParams.get('mockChapterTags'));
const mockChapterTagsEmbedError = mockParams.has('mockChapterTagsEmbedError');
// `?mockRegionsCreateError=1` makes the audio engine panel's "Create chapter regions…" dialog always fail to create, so its
// error state can be seen without a real REAPER round trip.
const mockRegionsCreateError = mockParams.has('mockRegionsCreateError');
// `?mockRegionsCapabilityOn=1` turns the 'regions' DAW capability on directly (bypassing the default Experimental-off
// gate, DAW.experimental_reaper_actions), so "Create chapter regions…"'s enabled Create button can be captured
// without also exercising the Settings toggle.
const mockRegionsCapabilityOn = mockParams.has('mockRegionsCapabilityOn');
// `?mockPunchCapabilityOn=1` turns the 'punch' DAW capability on directly (the same bypass as mockRegionsCapabilityOn),
// so "Punch from here"'s enabled state - the confirm dialog in the read-aloud rail, the pickup list's own button - can
// be captured without also exercising the Settings toggle.
const mockPunchCapabilityOn = mockParams.has('mockPunchCapabilityOn');
// `?mockRecordCapabilityOn=1` turns the 'record' DAW capability on directly (the same bypass), so the Booth's Record in
// REAPER toggle, its first-time confirm and a recording's "REC 06:42" can be captured.
const mockRecordCapabilityOn = mockParams.has('mockRecordCapabilityOn');
// `?mockDawConnected=0` boots with REAPER declared but its bridge not connected (the app opened on its own, not from REAPER's
// launcher action): every capability that needs the bridge answers 'standalone' once its settings allow it. With
// `mockRecordCapabilityOn=1` too, the Booth shows its REAPER connection steps.
const mockDawDisconnected = mockParams.get('mockDawConnected') === '0';
// `?mockRollReplaces=1` turns 'record' and 'punch' on and declares REAPER's punch destructive, the way a DAW that replaces audio on a
// roll declares it (Audacity without backups), so the Booth's roll asks first: the visual suite's `booth/roll-confirm`.
const mockRollReplaces = mockParams.has('mockRollReplaces');
// `?mockDawPlayhead=134.6` seeds the DAW port's live transport (daw_transport_changed) as playing at that project time, for
// the companion panel's playhead badge. Without it, the transport is stopped.
// `?mockDawRecording=1` boots with the DAW already recording a take this app did not start: the Booth after a reload mid-take, the take still running
// in REAPER (the reload lost this page's own memory of it).
const mockDawRecording = mockParams.has('mockDawRecording');
const mockDawPlayhead = Number.parseFloat(mockParams.get('mockDawPlayhead') ?? '');
// `?mockCoverage=hold|stale|pickups|cascade|recheck-required` holds a started recording check at its last
// transcribing step (so the running dialog can be seen), makes Chapter 4's stored check read stale (an item was
// trimmed since), or gives Chapter 4 two interior pickups (a skip and a short read) plus a small tail instead of its
// default tail-only split, and seeds a take-review pickup and two open project-wide pickups for the same chapter, so
// the recording check summary's headline, "Recorded to" line and all three Pickups lines can be seen together.
// `cascade` gives Chapter 4's result the model cascade's own
// pickups and recheck label; `recheck-required` answers the next
// start with the re-check model's own missing-model gate, offering "Check with tiny only" beside the download.
// `?mockCoverageRefusal=<reason>` answers every start with that refusal (docs/utilities/recording-coverage.md).
const mockCoverage = (['hold', 'stale', 'pickups', 'cascade', 'recheck-required'] as const).find((seed) => seed === mockParams.get('mockCoverage'));
const mockCoverageRefusal = COVERAGE_REFUSAL_REASONS.find((reason) => reason === mockParams.get('mockCoverageRefusal'));
// `?mockStages=mixed|error` puts the Home breakdown's stage suggestions in every state at
// once, or makes reading them fail. `mixed`: Chapter 4 read in full (suggested: Editing), Chapter 5 with no track linked (can't tell),
// Chapter 6 as the fixture has it (not ready), Chapter 7 confirmed into Editing and since found short (evidence changed), Chapter 8
// confirmed into Editing on evidence that still holds.
const mockStages = (['mixed', 'error'] as const).find((seed) => seed === mockParams.get('mockStages'));
// `?mockEditing=hold` holds a started editing check at its first item, so the
// running progress and Cancel (and the `partial` result a cancel leaves) can be seen. `?mockEditingRefusal=<reason>` answers
// every start with that refusal (apps/desktop/internal/editing/service.go). `?mockEditingCandidates=1` seeds Chapter 7 with
// two open empty-space candidates (in the shared findings store, same as any other finding) instead of the default clean
// pass, so the panel's candidate rows (Hear, Accept, Dismiss, Defer, Go to in REAPER) can be seen without a scan.
const mockEditing = (['hold'] as const).find((seed) => seed === mockParams.get('mockEditing'));
const mockEditingCandidates = mockParams.has('mockEditingCandidates');
const mockEditingRefusal = EDITING_REFUSAL_REASONS.find((reason) => reason === mockParams.get('mockEditingRefusal'));
// `?mockEditingSignal=never|stale|unsupported|settings-unset|met|not-met` seeds Chapter 7's (already in Editing status)
// empty-space signal directly, so a signal state that needs no scan click - shown at once in SR's evidence popover
// and the editing check panel alike - can be seen without a host. Click and breath are never seeded: their corpus
// validation has not shipped, so this mock, like the real engine, always reports them `unknown` (stagesMock.ts).
const mockEditingSignal = (['never', 'stale', 'unsupported', 'settings-unset', 'met', 'not-met'] as const).find(
  (seed) => seed === mockParams.get('mockEditingSignal'),
);
const MOCK_EDITING_SIGNAL_SEED: Record<NonNullable<typeof mockEditingSignal>, { unknown: StageUnknownCause; reason?: string } | 'met' | 'not_met'> = {
  never: { unknown: 'never_analyzed' },
  stale: { unknown: 'stale' },
  unsupported: { unknown: 'measurement_unavailable', reason: 'An item on this chapter’s track is not a WAV file the check can analyze.' },
  'settings-unset': { unknown: 'measurement_unavailable', reason: 'No maximum gap is set for empty space. Set it in Settings > Editing, then check again.' },
  met: 'met',
  'not-met': 'not_met',
};
// `?mockProofingStages=mixed` seeds the Proofing page panel's two default proofing-stage chapters:
// Chapter 9's pickups read clear (Suggested: Finalized), Chapter 10 has one open
// (Not ready), so the panel's summary and its evidence view can be seen without a host.
const mockProofingStages = mockParams.get('mockProofingStages') === 'mixed';
// `?mockProofingSignal=unmapped-track` seeds Chapter 9's pickups signal directly with an unknown cause that needs a track link, so
// the evidence view's cause action ("Open Tracks", never "Open recording check" - stageText.ts's `PROOFING_CAUSE_TEXT`) can be seen
// without a host.
const mockProofingSignal = mockParams.get('mockProofingSignal') === 'unmapped-track';
// `?mockProofingRender=chapter-9-stale` seeds Chapter 9's chosen render as stale, so the "Rendered file" section's
// stale state can be seen without choosing a file and then editing the
// chapter to invalidate it.
const mockProofingRenderStale = mockParams.get('mockProofingRender') === 'chapter-9-stale';
const MOCK_STAGES_MEASURED = { [WIRE_CHAPTERS[3].id]: 1 };
const MOCK_STAGES_SEEDS = {
  mixed: {
    recording: {
      [WIRE_CHAPTERS[4].id]: { unknown: 'unmapped_track' as const },
      [WIRE_CHAPTERS[6].id]: 'not_met' as const,
      [WIRE_CHAPTERS[7].id]: 'met' as const,
    },
    confirmed: [WIRE_CHAPTERS[6].id, WIRE_CHAPTERS[7].id],
  },
  error: { unavailable: 'the saved REAPER project could not be read' },
};
// `?mockChapterSuggestion=matched|ambiguous` arms tracks in the mock .rpp: the
// "Chapter 2" track alone, so the Teleprompter preselects Chapter 2 from it, or both chapter
// tracks, so it offers the two chapters as a choice instead.
const MOCK_ARMED_TRACKS = {
  matched: [WIRE_TRACKS_PROJECT.tracks[1].guid],
  ambiguous: [WIRE_TRACKS_PROJECT.tracks[0].guid, WIRE_TRACKS_PROJECT.tracks[1].guid],
} as const;
const mockChapterSuggestion = (['matched', 'ambiguous'] as const).find((seed) => seed === mockParams.get('mockChapterSuggestion'));
// `?mockFindings=empty|changed` boots the Review page with no findings at all, or with an analyzer that runs again right after the page
// lists its findings, so the empty queue and a decision refused on changed evidence can be seen without a host.
const mockFindings = (['empty', 'changed'] as const).find((seed) => seed === mockParams.get('mockFindings'));
// `?mockReaper=standalone|not-running|stale|recording|outdated` sets what the Review page's REAPER does for Go to, Loop and Stop:
// not there at all, gone quiet, or connected and refusing for that reason. Connected when absent.
const mockReaper = (['standalone', 'not-running', 'stale', 'recording', 'outdated'] as const).find((seed) => seed === mockParams.get('mockReaper'));
// `?mockTakeReviewScan=running` holds a started pickup and duplicate scan part way through, so its real
// progress and Cancel can be seen; without it a mock scan runs to the end in a few polls.
const mockTakeReviewScanHold = mockParams.get('mockTakeReviewScan') === 'running';
// `?mockTakeComparison=running` does the same for a take comparison.
const mockTakeComparisonHold = mockParams.get('mockTakeComparison') === 'running';
// `?mockMeasure=running|fails` holds a started measurement part way through (so Master & QC's progress and Cancel can be seen),
// or breaks it at its first poll. `?mockMeasure=spread` boots the
// page with several already-measured chapters whose levels vary (a book-wide spread),
// so it can be seen without measuring several files by hand. `?mockDeliveryProfile=custom` boots the project judged against a
// custom delivery profile, so the page judged by it can be seen without making one in
// Settings first; ACX judges otherwise.
const mockMeasure = (['running', 'fails', 'spread'] as const).find((seed) => seed === mockParams.get('mockMeasure'));
// `?mockDiagnostics=running|fails` does the same for Master & QC's Diagnostics section.
const mockDiagnostics = (['running', 'fails'] as const).find((seed) => seed === mockParams.get('mockDiagnostics'));
// `?mockRenderExport=running` does the same for Master & QC's export job.
const mockRenderExportHold = mockParams.get('mockRenderExport') === 'running';
// `?mockPackageMulti=running` holds a started multi-platform package build part way through, separately from
// `mockRenderExport` (which would also hold the export job itself mid-run, leaving no completed files to build
// packages from).
const mockPackageMultiHold = mockParams.get('mockPackageMulti') === 'running';
const mockDeliveryProfile = mockParams.get('mockDeliveryProfile') === 'custom' ? ('custom' as const) : undefined;
// `?mockDelivery=ready|building|fails|quiet` boots Delivery with every chapter and both credits files measured and passing and the files
// mastered and encoded, so Build is on: `ready` waits for a press (which builds at once), `building` holds a started build running,
// `fails` ends it with the host's refusal, `quiet` holds it running and then stops answering the job's reads.
const mockDelivery = (['ready', 'building', 'fails', 'quiet'] as const).find((seed) => seed === mockParams.get('mockDelivery'));
// `?mockProduction=on-pace|at-risk` seeds the Production page with a time log, a running timer (on-pace only), a deadline and a
// contracted amount; with none, nothing is logged or set yet.
const mockProduction = (['on-pace', 'at-risk'] as const).find((seed) => seed === mockParams.get('mockProduction'));
// `?mockFidelity=01` draws the mock backend as benchmark mock 01 draws Production, for the pixel-match tool (mockHost/mockFidelity.ts).
const mockFidelity = mockFidelityFrom(mockParams.get('mockFidelity'));

// `?mockRecorder=recording|failed|empty|no-devices|start-fails|unavailable` seeds the Booth's built-in recorder
// with `?mockEngine=builtin` choosing it: a take 42 s in; the last take ended on
// its own; no takes yet; no input device listed; a device that will not open on Record; the wasapi row unavailable here.
const MOCK_RECORDER_SEEDS: Record<string, RecordingMockSeed> = {
  recording: { recording: true },
  failed: { lastTakeFailed: true },
  empty: { takes: 'none' },
  'no-devices': { takes: 'none', devices: 'none' },
  'start-fails': { startFails: true },
  unavailable: { unavailable: true },
};
const mockRecorderParam = mockParams.get('mockRecorder') ?? '';
const mockRecorder = Object.hasOwn(MOCK_RECORDER_SEEDS, mockRecorderParam) ? MOCK_RECORDER_SEEDS[mockRecorderParam] : undefined;
// `?mockChapters=12|40` and `?mockHeadings=titleAndSubtitle|titleOnly|legacyNewline` boot the scenario book (SN-S61,
// fixtures/scenario.ts) in place of the Alice chapters; an unknown value is ignored.
const mockScenario = scenarioFromParams(mockParams);
// The chapter link the mock boots with: the seed, else Chapter 1 linked to its track. The consent and suggestion seeds show the flow that makes the
// first link, so they start from none.
const chapterLink = mockChapterLinkSeed ?? (mockChapterSync || mockChapterSuggestion ? 'none' : 'confirmed');
/** The DAW seed every `mockDaw*` and `mock*CapabilityOn` param adds to, merged: a later param adds to what an earlier one set (their toggles and
 * depths together) instead of replacing it. */
function mergeDawSeeds(...parts: Array<DawMockSeed | undefined>): DawMockSeed | undefined {
  const present = parts.filter((part): part is DawMockSeed => part !== undefined);
  if (present.length === 0) return undefined;
  return present.reduce<DawMockSeed>(
    (merged, part) => ({
      ...merged,
      ...part,
      toggles: { ...merged.toggles, ...part.toggles },
      depth: { ...merged.depth, ...part.depth },
    }),
    {},
  );
}
const mockInitial = {
  ...(mockScenario ? mockScenario.seed : {}),
  ...(mockFidelity ? MOCK_FIDELITY[mockFidelity] : {}),
  ...(mockRecorder ? { recording: mockRecorder } : {}),
  ...(mockMeasure ? { measure: mockMeasure === 'running' ? ('hold' as const) : mockMeasure === 'spread' ? ('spread' as const) : ('fails' as const) } : {}),
  ...(mockDiagnostics ? { diagnostics: mockDiagnostics === 'running' ? ('hold' as const) : ('fails' as const) } : {}),
  ...(mockDelivery ? { measure: 'delivery-ready' as const, renderExport: mockDelivery } : {}),
  ...(mockRenderExportHold ? { renderExport: 'hold' as const } : {}),
  ...(mockPackageMultiHold ? { renderPackageMulti: 'hold' as const } : {}),
  ...(mockDeliveryProfile ? { deliveryProfile: mockDeliveryProfile } : {}),
  ...(mockProduction ? { production: scenarioFromToday(mockProduction) } : {}),
  ...(mockTakeReviewScanHold ? { takeReviewScanHold: true } : {}),
  ...(mockTakeComparisonHold ? { takeComparisonHold: true } : {}),
  ...(mockReaper ? { reaper: mockReaper } : {}),
  ...(mockFindings === 'empty' ? { findings: [] } : {}),
  ...(mockFindings === 'changed' ? { findingsRerun: true } : {}),
  ...(mockImportPreview ? { importPreview: mockImportPreview } : {}),
  ...(mockAssets ? { assets: mockAssets } : {}),
  ...(mockSeries ? { seriesVoiceBible: mockSeries } : {}),
  ...(mockDictionary ? { dictionary: mockDictionary } : {}),
  ...(mockUpdate ? { update: mockUpdate } : {}),
  ...(mockLiveDegraded ? { liveUpdatesDegraded: true } : {}),
  ...(mockRebuildRunning ? { rebuildRunning: true } : {}),
  ...(mockBuild ? { build: mockBuild } : {}),
  ...(mockHoldEdits ? { holdEdits: true } : {}),
  ...(mockInvalidPayload ? { invalidPayload: mockInvalidPayload } : {}),
  ...(mockNoManuscript ? { noManuscript: true } : {}),
  ...(mockPickupList ? { pickupList: mockPickupList } : {}),
  ...(mockNoDaw ? { dawFileLinked: false } : {}),
  ...(mockDawMismatch ? { dawEngineMismatch: true } : {}),
  ...(mockDawNotDetected ? { dawCatalogInstalled: false } : {}),
  ...(mockCreditsMissing ? { creditsMissingClosing: true } : {}),
  ...(mockCreditsDetected ? { creditsDetected: true } : {}),
  ...(mockCreditsSetup ? { creditsSetup: true } : {}),
  ...(mockPreviewError ? { previewError: mockPreviewError } : {}),
  ...(mockPreviewCandidatesParam === 'no-manuscript' ? { preview: { outcome: 'no_manuscript' as const } } : {}),
  ...(mockPreviewCandidatesParam === 'nothing-eligible' ? { preview: { outcome: 'nothing_eligible' as const } } : {}),
  ...(mockPreviewCandidatesParam === 'computing' ? { preview: { hold: true } } : {}),
  ...(mockPreviewCandidatesParam === 'shorter' ? { preview: { outcome: 'ok' as const, candidates: [MOCK_PREVIEW_SHORTER_CANDIDATE] } } : {}),
  ...(mockPreviewCandidatesParam === 'warnings' ? { preview: { outcome: 'ok' as const, candidates: [MOCK_PREVIEW_WARNING_CANDIDATE] } } : {}),
  ...(mockPreviewCandidatesParam === 'pinned'
    ? { preview: { pin: { chapterId: MOCK_PREVIEW_PIN_CHAPTER.id, paragraphIds: MOCK_PREVIEW_PIN_PARAGRAPH_IDS } } }
    : {}),
  ...(mockPreviewCandidatesParam === 'pin-stale'
    ? { preview: { pin: { chapterId: MOCK_PREVIEW_PIN_CHAPTER.id, paragraphIds: MOCK_PREVIEW_PIN_PARAGRAPH_IDS, stale: 'text_changed' as const } } }
    : {}),
  ...(mockTeleprompter ? { teleprompter: mockTeleprompter } : {}),
  ...(mockNoDevices ? { teleprompterDevices: [] } : {}),
  ...(mockBoothStress ? boothStressSeed(mockBoothStress) : {}),
  ...(mockMicsStress
    ? {
        teleprompterDevices: micStressDevices(mockMicsStress),
        recording: {
          deviceNames: micStressDevices(mockMicsStress).map((device) => device.name),
          ...(mockMicsStress === '0' ? { devices: 'none' as const } : {}),
        },
      }
    : {}),
  ...(mockLevel === undefined ? {} : { teleprompterLevel: mockLevel }),
  ...(mockZoom === undefined ? {} : { zoom: mockZoom }),
  ...(mockReaperState ? { reaperState: mockReaperState } : {}),
  ...(mockReaperInput ? { reaperInput: mockReaperInput } : {}),
  ...(mockResume ? { resume: mockResume } : {}),
  ...(mockRemoved ? { removedChapter: true } : {}),
  ...(mockChapterSync ? { chapterSync: mockChapterSync } : {}),
  ...(mockCreditsFilled ? { creditValues: { title: 'Alice’s Adventures in Wonderland', author: 'Lewis Carroll', narrator: 'Ada Finch' } } : {}),
  ...(mockCreditsSetupNarratorDefault ? { creditValues: { narrator: 'Jamie Rivers' } } : {}),
  ...(mockCreditsExtras ? { chapterAnnouncement: '[Chapter]{: [Chapter Title]}.', retailSample: { chapterIndex: 2, startLine: 1, endLine: 3 } } : {}),
  ...(mockNoProject ? { projectFolder: '' } : {}),
  ...(mockMultipleRpp ? { tracksCandidates: ['C:/Projects/Alice-in-Wonderland/Alice.rpp', 'C:/Projects/Alice-in-Wonderland/Alice-alt-mix.rpp'] } : {}),
  ...(mockNoRpp ? { tracksCandidates: [] } : {}),
  ...(mockManuscriptCandidate ? { manuscriptCandidate: { path: 'C:/Projects/Alice-in-Wonderland/manuscript.docx', name: 'manuscript.docx' } } : {}),
  ...(mockManuscriptMixed ? { mockManuscript: 'mixed' as const } : {}),
  ...(chapterLink === 'missing'
    ? {
        chapterTrackMappings: [
          { trackGuid: '{NOT-A-REAL-TRACK-GUID}', chapterId: WIRE_CHAPTERS[0].id, chapterTitle: WIRE_CHAPTERS[0].title, confirmedAt: '2026-09-01T12:00:00Z' },
        ],
      }
    : {}),
  ...(chapterLink === 'ambiguous'
    ? {
        chapterTrackMappings: [
          {
            trackGuid: WIRE_TRACKS_PROJECT.tracks[0].guid,
            chapterId: WIRE_CHAPTERS[0].id,
            chapterTitle: WIRE_CHAPTERS[0].title,
            confirmedAt: '2026-09-01T12:00:00Z',
          },
          {
            trackGuid: WIRE_TRACKS_PROJECT.tracks[1].guid,
            chapterId: WIRE_CHAPTERS[0].id,
            chapterTitle: WIRE_CHAPTERS[0].title,
            confirmedAt: '2026-09-02T12:00:00Z',
          },
        ],
      }
    : {}),
  ...(chapterLink === 'confirmed'
    ? {
        chapterTrackMappings: [
          {
            trackGuid: WIRE_TRACKS_PROJECT.tracks[0].guid,
            chapterId: WIRE_CHAPTERS[0].id,
            chapterTitle: WIRE_CHAPTERS[0].title,
            confirmedAt: '2026-09-01T12:00:00Z',
          },
        ],
      }
    : {}),
  ...(mockLineIdentity ? { lineIdentity: mockLineIdentity } : {}),
  ...(mockPickups ? { pickups: mockPickups } : {}),
  ...(mockRenderConfig ? { renderConfig: mockRenderConfig } : {}),
  ...(mockCleanupTools ? { cleanupTools: mockCleanupTools } : {}),
  ...(mockRetakeLanes ? { retakeLanes: mockRetakeLanes } : {}),
  ...(mockChapterTags ? { chapterTags: mockChapterTags } : {}),
  ...(mockChapterTagsEmbedError ? { chapterTagsEmbedAlwaysErrors: true } : {}),
  ...(mockRegionsCreateError ? { regionsCreateAlwaysErrors: true } : {}),
  ...(mockCoverage || mockCoverageRefusal || mockStages === 'mixed'
    ? {
        coverage: {
          ...(mockStages === 'mixed' ? { measured: MOCK_STAGES_MEASURED } : {}),
          ...(mockCoverage === 'hold' ? { hold: true } : {}),
          ...(mockCoverage === 'stale' ? { stale: [WIRE_CHAPTERS[3].id] } : {}),
          ...(mockCoverage === 'pickups' || mockCoverage === 'cascade' ? { pickups: [WIRE_CHAPTERS[3].id] } : {}),
          ...(mockCoverage === 'cascade' ? { cascade: [WIRE_CHAPTERS[3].id] } : {}),
          ...(mockCoverage === 'recheck-required' ? { recheckAssetRequired: true } : {}),
          ...(mockCoverageRefusal ? { refusal: mockCoverageRefusal } : {}),
        },
      }
    : {}),
  // Chapter 4's other pickups: one unreviewed take-review pickup
  // for the same chapter `?mockCoverage=pickups` gives interior gaps, so the summary's own gaps and its "Take
  // review" count and Open Review link can be seen together, as the mockup does.
  ...(mockCoverage === 'pickups' ? { findings: [...WIRE_FINDINGS, takeReviewPickupFor(WIRE_CHAPTERS[3].id, WIRE_CHAPTERS[3].title)] } : {}),
  // The proofer's project-wide pickup list: two still open, so the
  // summary's "Pickup list" line reads a real count alongside the check's own gaps and take review's, as the mockup does.
  ...(mockCoverage === 'pickups' ? { pickups: 'next-success' as const } : {}),
  ...(mockChapterSuggestion ? { armedTracks: MOCK_ARMED_TRACKS[mockChapterSuggestion] } : {}),
  ...(mockStages ? { stages: MOCK_STAGES_SEEDS[mockStages] } : {}),
  ...(mockEditing || mockEditingRefusal
    ? {
        editing: {
          ...(mockEditingRefusal ? { refusal: mockEditingRefusal } : {}),
          ...(mockEditing === 'hold' ? { hold: true } : {}),
        },
      }
    : {}),
  ...(mockEditingCandidates
    ? {
        findings: [
          ...WIRE_FINDINGS,
          editingCandidateFor(WIRE_CHAPTERS[6].id, WIRE_CHAPTERS[6].title, 0),
          editingCandidateFor(WIRE_CHAPTERS[6].id, WIRE_CHAPTERS[6].title, 1),
        ],
      }
    : {}),
  ...(mockEditingSignal
    ? { stages: { ...(mockStages ? MOCK_STAGES_SEEDS[mockStages] : {}), editing: { [WIRE_CHAPTERS[6].id]: MOCK_EDITING_SIGNAL_SEED[mockEditingSignal] } } }
    : {}),
  ...(mockProofingStages ? { stages: { proofing: { [WIRE_CHAPTERS[8].id]: 'met' as const, [WIRE_CHAPTERS[9].id]: 'not_met' as const } } } : {}),
  ...(mockProofingSignal ? { stages: { proofing: { [WIRE_CHAPTERS[8].id]: { unknown: 'unmapped_track' as StageUnknownCause } } } } : {}),
  ...(mockProofingRenderStale ? { proofingRender: { [WIRE_CHAPTERS[8].id]: { state: 'stale' as const } } } : {}),
  ...(mockDawScript ? { dawScript: mockDawScript, dawFileLinked: false } : {}),
  ...(mockDawChoice ? { dawChoice: DAW_CHOICE_MOCK_SEEDS[mockDawChoice] } : {}),
  daw: mergeDawSeeds(
    mockScenario?.seed.daw,
    mockDawExperimentalOn ? { experimentalOn: true } : undefined,
    mockDawAudacity ? { daw: 'Audacity' } : undefined,
    mockDawScript ? { connected: false } : undefined,
    mockRegionsCapabilityOn ? { toggles: { regions: 'on' } } : undefined,
    mockPunchCapabilityOn ? { toggles: { punch: 'on' } } : undefined,
    mockRecordCapabilityOn ? { toggles: { record: 'on' } } : undefined,
    mockDawDisconnected ? { connected: false } : undefined,
    mockRollReplaces ? { toggles: { record: 'on', punch: 'on' }, depth: { punch: { destructive: true } } } : undefined,
    mockDawChoice ? (mockDawChoice === 'not-running' ? { connected: true, reachable: false } : { connected: false }) : undefined,
    Number.isFinite(mockDawPlayhead) ? { transport: { playing: true, recording: false, position: mockDawPlayhead } } : undefined,
    mockDawRecording ? { transport: { playing: true, recording: true, position: 12 } } : undefined,
  ),
};
const api = import.meta.env.VITE_USE_MOCK_API === '1' ? createMockApi(window.__NARRATION_MOCK_OVERRIDES__, mockInitial) : wailsClient;
if (api === wailsClient) enableUiLog();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ApiProvider api={api}>
        {/* docs/architecture/studio-shell-and-registries.md: the command registry with keyboard, MIDI and HID as its input sources. Wired to the DAW port's
            live transport state, so a `noisy` command (workspace.play, Editing's Play) goes silent while the DAW reports recording. */}
        <LiveCommandRouter source={commandInputSource}>
          <App />
        </LiveCommandRouter>
      </ApiProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

// `?mockPanel=1` opens the dev-only Mock states panel beside the app. Only the mock build reaches the dynamic import, so the
// shipped build holds neither the panel nor its sentence.
if (import.meta.env.VITE_USE_MOCK_API === '1' && mockParams.get('mockPanel') === '1') {
  void import('./components/devtools/MockStatesPanel').then(({ mountMockStatesPanel }) => mountMockStatesPanel());
}
