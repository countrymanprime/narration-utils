import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { wailsClient } from './api/wailsClient';
import { createMockApi } from './api/mockApi';
import { WIRE_CHAPTERS, WIRE_FINDINGS, WIRE_TRACKS_PROJECT, editingCandidateFor, takeReviewPickupFor } from './api/mockFixtures';
import { COVERAGE_REFUSAL_REASONS } from './api/schemas/coverage';
import { EDITING_REFUSAL_REASONS } from './api/schemas/editing';
import type { StageUnknownCause } from './api/contracts/stages';
import { MOCK_RESUME_SEEDS } from './api/resumeMockSeed';
import { MOCK_REAPER_INPUT_SEEDS, MOCK_REAPER_SEEDS } from './api/teleprompterMock';
import { ThemeProvider } from './theme/ThemeContext';
import { CommandRouter } from './input/router';
import './fonts';
import './styles.css';

// Mock mode runs the complete UI in a browser without the desktop host.
//
// Visual tests set mock overrides before the app starts.
declare global {
  interface Window {
    __NARRATION_MOCK_OVERRIDES__?: Parameters<typeof createMockApi>[0];
  }
}
// Production is a native Wails window. Browser use is supported only through
// the explicit mock mode used by UI tests; no loopback HTTP host exists.
// `?mockNoProject=1` boots straight into ProjectPicker (no project folder
// attached yet) - a URL param rather than a window global so a Playwright
// driver can reach it with a plain second `page.goto`, no init-script
// plumbing needed before the app's first render.
// `?mockMultipleRpp=1` seeds two .rpp candidates so the Tracks page shows
// its choose-a-project-file prompt instead of auto-selecting the only one.
const mockParams = new URLSearchParams(window.location.search);
const mockNoProject = mockParams.has('mockNoProject');
const mockMultipleRpp = mockParams.has('mockMultipleRpp');
// `?mockNoRpp=1` seeds zero candidates: the project folder has no .rpp file.
const mockNoRpp = mockParams.has('mockNoRpp');
// `?mockNoDaw=1` boots a project with no linked REAPER project (.rpp) file (PRD project-workspace-and-daw-link.prd.md,
// Phase 4): the header pill reads "No REAPER project linked", Proofing's nav item/Home card/Start are gated, and
// Tracks/Settings show their unlinked DAW-link controls. The mock otherwise defaults `dawFileLinked` to true so every
// other capture (and App.test.tsx's default click into Proofing) keeps working without this param.
const mockNoDaw = mockParams.has('mockNoDaw');
// `?mockDawNotDetected=1` makes the DAW catalog panel (Settings > DAW Integration, docs/architecture/
// daw-integration.md) report REAPER as not detected, so its "Get REAPER" button can be seen without a host.
const mockDawNotDetected = mockParams.has('mockDawNotDetected');
// `?mockCreditsMissing=1` drops the closing credit templates (credits-in-chapter-table.prd.md Phase 2, CT5): Home's
// chapter table shows the Closing credits row as "Not set up" with a link to Settings > Credits.
const mockCreditsMissing = mockParams.has('mockCreditsMissing');
// `?mockNoManuscript=1` boots a project with no manuscript imported yet, so
// Home shows its manuscript-not-found banner and Proofing/Story Bible are locked.
const mockNoManuscript = mockParams.has('mockNoManuscript');
// `?mockManuscriptCandidate=1` boots a project with no imported manuscript but a
// manuscript.docx in its folder, so Home shows the import offer.
const mockManuscriptCandidate = mockParams.has('mockManuscriptCandidate');
// `?mockManuscript=mixed` adds a buttonless Front Matter row and a 5-digit word count to the Manuscript page's chapter
// list, so the header's aligned stat block and action slot can be seen across a mix of row shapes
// (manuscript-chapter-header-alignment.prd.md), plus four of the owner's chapter-heading shapes - source capitals
// with a subtitle, no subtitle, a long subtitle, and a title already ending in a colon - so a chapter's name reads
// the same way everywhere it is drawn (chapter-title-display-consistency.prd.md).
const mockManuscriptMixed = mockParams.get('mockManuscript') === 'mixed';
// `?mockTeleprompter=listening|waiting|done|flagged` boots the teleprompter already part-way
// through the first chapter, as a session the host kept running (`flagged`: further in, with suspected flags raised);
// `ended` boots one that already stopped itself at the end of the chapter (the host's auto-stop).
const mockTeleprompter = (['listening', 'waiting', 'done', 'ended', 'flagged'] as const).find((seed) => seed === mockParams.get('mockTeleprompter'));
// `?mockLevel=-18` makes every microphone level the teleprompter mock sends that RMS in dBFS (-100 to 0), so the level meter
// holds still for a capture (read-aloud-control-bar.prd.md Phase 4).
const mockLevelParam = Number(mockParams.get('mockLevel') ?? Number.NaN);
const mockLevel = Number.isFinite(mockLevelParam) && mockLevelParam >= -100 && mockLevelParam <= 0 ? mockLevelParam : undefined;
// `?mockReaperState=ready|not_armed|other_armed|several_armed|no_link|recording_elsewhere|unavailable|experimental_off` makes
// the read-aloud dialog's REAPER state (read-aloud-control-bar.prd.md Phase 6) answer that for every chapter.
const mockReaperState = MOCK_REAPER_SEEDS.find((seed) => seed === mockParams.get('mockReaperState'));
// `?mockReaperInput=matched|uncertain|no_match|reaper_no_device|experimental_off` makes the microphone REAPER records from
// (teleprompter-manuscript-integration.prd.md Phase 11) answer that.
const mockReaperInput = MOCK_REAPER_INPUT_SEEDS.find((seed) => seed === mockParams.get('mockReaperInput'));
// `?mockResume=agree|disagree|prompter_only|low_confidence|complete|not_found|ambiguous|none|no_recording|source_missing|source_unsupported|error`
// makes the read-aloud dialog's resume prompt (read-aloud-resume-from-daw.prd.md Phase 1) show that state for any chapter,
// so each can be seen without a REAPER project, a recording or a Whisper run.
const mockResume = MOCK_RESUME_SEEDS.find((seed) => seed === mockParams.get('mockResume'));
// `?mockRemoved=1`: the last narration chapter boots removed from recording (chapter-track-link-control.prd.md Phase 3).
const mockRemoved = mockParams.get('mockRemoved') === '1';
// `?mockChapterSync=ask|off|linked|unsaved|pickups`: chapter sync's consent at boot (daw-chapter-track-auto-sync.prd.md
// Phases 3, 4 and 8; `unsaved` is REAPER holding unsaved edits, with a Sync activity row; `pickups` is a chapter whose
// pickup track changed since its last scan).
const mockChapterSync = (['ask', 'off', 'linked', 'unsaved', 'pickups'] as const).find((seed) => seed === mockParams.get('mockChapterSync'));
// `?mockNoDevices=1` boots the teleprompter with an empty device listing, so the
// blocked "No microphone found" state (no typed fallback) can be seen without a host.
const mockNoDevices = mockParams.has('mockNoDevices');
// `?mockCredits=filled` boots the project with its credits values set (title, author, narrator), so the credits read on the
// teleprompter with every token resolved can be seen without saving them in Settings first (credits PRD Phase 4).
// `?mockCredits=extras` does that too and adds a chapter announcement template and a retail sample on lines 1-3 of
// Chapter 3 (credits PRD Phase 5), so the announcement preview and the sample marker can be seen without picking them.
const mockCreditsExtras = mockParams.get('mockCredits') === 'extras';
const mockCreditsFilled = mockParams.get('mockCredits') === 'filled' || mockCreditsExtras;
// `?mockCredits=detected` widens the manuscript-detected candidates past Title/Author to every token the front matter
// parser can find - Year, Copyright holder, a low-confidence Publisher - so Settings > Credits' per-field source
// caption can be seen on every field (credits-token-setup-and-front-matter-detection.prd.md Phase 1).
const mockCreditsDetected = mockParams.get('mockCredits') === 'detected';
// `?mockCredits=setup`: the project has no credits values and its setup prompt has not been answered, so Home asks
// (credits-token-setup-and-front-matter-detection.prd.md Phase 2).
const mockCreditsSetup = mockParams.get('mockCredits') === 'setup' || mockParams.get('mockCredits') === 'setup-narrator-default';
// `?mockCredits=setup-narrator-default`: as `setup`, but the narrator token already has a value, so the prompt asks
// for only Title and Author - the state a returning narrator with a saved default sees (CS7 B).
const mockCreditsSetupNarratorDefault = mockParams.get('mockCredits') === 'setup-narrator-default';
// `?mockPreviewError=<text>` makes the Story Bible preview fail with that text once the
// preview voice is installed, so the failure toast can be seen without a real host.
const mockPreviewError = mockParams.get('mockPreviewError');
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
// `?mockDictionary=missing|damaged` boots without the offline dictionary, or with one whose index fails its check, so the reader's Look up asks to
// download it (or to download it again) first (story-bible-and-import-ux-briefs.prd.md Phase 8).
const mockDictionary = (['missing', 'damaged'] as const).find((seed) => seed === mockParams.get('mockDictionary'));
// `?mockImportPreview=markdown|repaired|text` makes the next manuscript import a Markdown file (so the chapter heading level choice can be seen in the review dialog), a
// Word file whose headings the importer had to repair (so the repairs note can), or a plain-text file with an epigraph read as a subtitle (so a subtitle
// that returns to the text when it is turned off can).
const mockImportPreview = (['markdown', 'repaired', 'text'] as const).find((kind) => kind === mockParams.get('mockImportPreview'));
// `?mockChapterLink=missing|ambiguous|confirmed` seeds the first chapter's mapping directly, so a track-link state
// that would otherwise need a real REAPER round trip (or several link/relink clicks) can be seen on load: `missing`
// confirms a track GUID that is not in the mock REAPER project (Tracks page's "Track missing" state, analysis
// evidence ledger PRD Phase 7); `ambiguous` confirms it to two tracks at once (chapter-track-link-control.prd.md
// Phase 2, TL6); `confirmed` links it to its own suggested "Chapter 1" track outright, without a Change/Confirm click.
const mockChapterLink = (['missing', 'ambiguous', 'confirmed'] as const).find((seed) => seed === mockParams.get('mockChapterLink'));
// `?mockLineIdentity=success|conflict|error` boots the Tracks page's "Link chapters" dialog with LineIdentityState already at that
// result, so its stale/conflict/drift and error states can be seen without a real REAPER round trip.
const mockLineIdentity = (['success', 'conflict', 'error'] as const).find((seed) => seed === mockParams.get('mockLineIdentity'));
// `?mockPickups=import-success|next-success|export-success|error` boots the Tracks page's "Pickups" dialog with
// PickupsState already at that result, so the remaining-count, next and export states can be seen without a real
// REAPER round trip.
const mockPickups = (['import-success', 'next-success', 'export-success', 'error'] as const).find((seed) => seed === mockParams.get('mockPickups'));
// `?mockRenderConfig=success|no-regions|error` boots the Tracks page's "Prepare chapter render" dialog with
// RenderConfigState already at that result, so the confirmed-file-names, no-regions-yet and error states can be
// seen without a real REAPER round trip.
const mockRenderConfig = (['success', 'no-regions', 'error'] as const).find((seed) => seed === mockParams.get('mockRenderConfig'));
// `?mockCleanupTools=launched|error` boots the Tracks page's "Cleanup tools" dialog with CleanupToolsState already at
// that result (error: Magnolius DeClick not installed), so both can be seen without a real REAPER round trip.
const mockCleanupTools = (['launched', 'error'] as const).find((seed) => seed === mockParams.get('mockCleanupTools'));
// `?mockRetakeLanes=picked|error|none` boots the Tracks page's "Retakes on lanes" dialog at that result (none: a project
// with no fixed-lane track), so each can be seen without a real REAPER round trip.
const mockRetakeLanes = (['picked', 'error', 'none'] as const).find((seed) => seed === mockParams.get('mockRetakeLanes'));
// `?mockChapterTags=ready|not-rendered` boots the Tracks page's "Embed chapter tags" dialog with ChapterTagsPreview
// already at that result, so the ready and not-yet-rendered states can be seen without a real chapter render.
// `?mockChapterTagsEmbedError=1` makes the embed action always fail, so the error state can be seen too.
const mockChapterTags = (['ready', 'not-rendered'] as const).find((seed) => seed === mockParams.get('mockChapterTags'));
const mockChapterTagsEmbedError = mockParams.has('mockChapterTagsEmbedError');
// `?mockCoverage=hold|stale|pickups` holds a started recording check at its last transcribing step (so the running
// dialog can be seen), makes Chapter 4's stored check read stale (an item was trimmed since), or gives Chapter 4 two
// interior pickups (a skip and a short read) plus a small tail instead of its default tail-only split, so the
// recording check summary's headline, "Recorded to" line and Pickups list can all be seen together
// (recording-check-summary.prd.md Phase 1). `?mockCoverageRefusal=<reason>` answers every start with that refusal
// (docs/utilities/recording-coverage.md, ADR 0130).
const mockCoverage = (['hold', 'stale', 'pickups'] as const).find((seed) => seed === mockParams.get('mockCoverage'));
const mockCoverageRefusal = COVERAGE_REFUSAL_REASONS.find((reason) => reason === mockParams.get('mockCoverageRefusal'));
// `?mockStages=mixed|error` puts the Home breakdown's stage suggestions (chapter-stage-recommendations.prd.md Phase 5) in every state at
// once, or makes reading them fail. `mixed`: Chapter 4 read in full (suggested: Editing), Chapter 5 with no track linked (can't tell),
// Chapter 6 as the fixture has it (not ready), Chapter 7 confirmed into Editing and since found short (evidence changed), Chapter 8
// confirmed into Editing on evidence that still holds.
const mockStages = (['mixed', 'error'] as const).find((seed) => seed === mockParams.get('mockStages'));
// `?mockEditing=hold` holds a started editing check at its first item (editing-readiness-analysis.prd.md Phase 7), so the
// running progress and Cancel (and the `partial` result a cancel leaves) can be seen. `?mockEditingRefusal=<reason>` answers
// every start with that refusal (apps/desktop/internal/editing/service.go). `?mockEditingCandidates=1` seeds Chapter 7 with
// two open empty-space candidates (in the shared findings store, same as any other finding) instead of the default clean
// pass, so the panel's candidate rows (Hear, Accept, Dismiss, Defer, Go to in REAPER) can be seen without a scan.
const mockEditing = (['hold'] as const).find((seed) => seed === mockParams.get('mockEditing'));
const mockEditingCandidates = mockParams.has('mockEditingCandidates');
const mockEditingRefusal = EDITING_REFUSAL_REASONS.find((reason) => reason === mockParams.get('mockEditingRefusal'));
// `?mockEditingSignal=never|stale|unsupported|settings-unset|met|not-met` seeds Chapter 7's (already in Editing status)
// empty-space signal directly, so a signal state that needs no scan click - shown at once in SR's evidence popover
// and the editing check panel alike - can be seen without a host. Click and breath are never seeded: Phase 4 has not
// shipped, so this mock, like the real engine, always reports them `unknown` (stagesMock.ts).
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
// `?mockChapterSuggestion=matched|ambiguous` arms tracks in the mock .rpp (teleprompter-engines-and-input-devices PRD
// Phase 11, ADR 0113): the "Chapter 2" track alone, so the Teleprompter preselects Chapter 2 from it, or both chapter
// tracks, so it offers the two chapters as a choice instead.
const MOCK_ARMED_TRACKS = {
  matched: [WIRE_TRACKS_PROJECT.tracks[1].guid],
  ambiguous: [WIRE_TRACKS_PROJECT.tracks[0].guid, WIRE_TRACKS_PROJECT.tracks[1].guid],
} as const;
const mockChapterSuggestion = (['matched', 'ambiguous'] as const).find((seed) => seed === mockParams.get('mockChapterSuggestion'));
// `?mockFindings=empty|changed` boots the Review page with no findings at all, or with an analyzer that runs again right after the page
// lists its findings, so the empty queue and a decision refused on changed evidence (ADR 0120) can be seen without a host.
const mockFindings = (['empty', 'changed'] as const).find((seed) => seed === mockParams.get('mockFindings'));
// `?mockReaper=standalone|not-running|stale|recording|outdated` sets what the Review page's REAPER does for Go to, Loop and Stop
// (review dashboard Phase 7): not there at all, gone quiet, or connected and refusing for that reason. Connected when absent.
const mockReaper = (['standalone', 'not-running', 'stale', 'recording', 'outdated'] as const).find((seed) => seed === mockParams.get('mockReaper'));
// `?mockTakeReviewScan=running` holds a started pickup and duplicate scan part way through (take review Phase 5), so its real
// progress and Cancel can be seen; without it a mock scan runs to the end in a few polls.
const mockTakeReviewScanHold = mockParams.get('mockTakeReviewScan') === 'running';
// `?mockTakeComparison=running` does the same for a take comparison (take review Phase 10).
const mockTakeComparisonHold = mockParams.get('mockTakeComparison') === 'running';
// `?mockMeasure=running|fails` holds a started measurement part way through (so the Delivery page's progress and Cancel can be seen),
// or breaks it at its first poll (diagnostics-delivery-and-cleanup-tools.prd.md Phases 1 and 5). `?mockDeliveryProfile=custom` boots
// the project judged against a custom delivery profile (delivery-platform-profiles.prd.md), so the page judged by it can be seen
// without making one in Settings first; ACX judges otherwise.
const mockMeasure = (['running', 'fails'] as const).find((seed) => seed === mockParams.get('mockMeasure'));
// `?mockDiagnostics=running|fails` does the same for the Delivery page's Diagnostics tab (diagnostics PRD Phase 6).
const mockDiagnostics = (['running', 'fails'] as const).find((seed) => seed === mockParams.get('mockDiagnostics'));
const mockDeliveryProfile = mockParams.get('mockDeliveryProfile') === 'custom' ? ('custom' as const) : undefined;
const mockInitial = {
  ...(mockMeasure ? { measure: mockMeasure === 'running' ? ('hold' as const) : ('fails' as const) } : {}),
  ...(mockDiagnostics ? { diagnostics: mockDiagnostics === 'running' ? ('hold' as const) : ('fails' as const) } : {}),
  ...(mockDeliveryProfile ? { deliveryProfile: mockDeliveryProfile } : {}),
  ...(mockTakeReviewScanHold ? { takeReviewScanHold: true } : {}),
  ...(mockTakeComparisonHold ? { takeComparisonHold: true } : {}),
  ...(mockReaper ? { reaper: mockReaper } : {}),
  ...(mockFindings === 'empty' ? { findings: [] } : {}),
  ...(mockFindings === 'changed' ? { findingsRerun: true } : {}),
  ...(mockImportPreview ? { importPreview: mockImportPreview } : {}),
  ...(mockAssets ? { assets: mockAssets } : {}),
  ...(mockDictionary ? { dictionary: mockDictionary } : {}),
  ...(mockUpdate ? { update: mockUpdate } : {}),
  ...(mockLiveDegraded ? { liveUpdatesDegraded: true } : {}),
  ...(mockRebuildRunning ? { rebuildRunning: true } : {}),
  ...(mockBuild ? { build: mockBuild } : {}),
  ...(mockHoldEdits ? { holdEdits: true } : {}),
  ...(mockInvalidPayload ? { invalidPayload: mockInvalidPayload } : {}),
  ...(mockNoManuscript ? { noManuscript: true } : {}),
  ...(mockNoDaw ? { dawFileLinked: false } : {}),
  ...(mockDawNotDetected ? { dawCatalogInstalled: false } : {}),
  ...(mockCreditsMissing ? { creditsMissingClosing: true } : {}),
  ...(mockCreditsDetected ? { creditsDetected: true } : {}),
  ...(mockCreditsSetup ? { creditsSetup: true } : {}),
  ...(mockPreviewError ? { previewError: mockPreviewError } : {}),
  ...(mockTeleprompter ? { teleprompter: mockTeleprompter } : {}),
  ...(mockNoDevices ? { teleprompterDevices: [] } : {}),
  ...(mockLevel === undefined ? {} : { teleprompterLevel: mockLevel }),
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
  ...(mockChapterLink === 'missing'
    ? {
        chapterTrackMappings: [
          { trackGuid: '{NOT-A-REAL-TRACK-GUID}', chapterId: WIRE_CHAPTERS[0].id, chapterTitle: WIRE_CHAPTERS[0].title, confirmedAt: '2026-09-01T12:00:00Z' },
        ],
      }
    : {}),
  ...(mockChapterLink === 'ambiguous'
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
  ...(mockChapterLink === 'confirmed'
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
  ...(mockCoverage || mockCoverageRefusal || mockStages === 'mixed'
    ? {
        coverage: {
          ...(mockStages === 'mixed' ? { measured: MOCK_STAGES_MEASURED } : {}),
          ...(mockCoverage === 'hold' ? { hold: true } : {}),
          ...(mockCoverage === 'stale' ? { stale: [WIRE_CHAPTERS[3].id] } : {}),
          ...(mockCoverage === 'pickups' ? { pickups: [WIRE_CHAPTERS[3].id] } : {}),
          ...(mockCoverageRefusal ? { refusal: mockCoverageRefusal } : {}),
        },
      }
    : {}),
  // Chapter 4's other pickups (recording-check-summary.prd.md Phase 3, RS4 A): one unreviewed take-review pickup
  // for the same chapter `?mockCoverage=pickups` gives interior gaps, so the summary's own gaps and its "Take
  // review" count and Open Review link can be seen together, as the mockup does.
  ...(mockCoverage === 'pickups' ? { findings: [...WIRE_FINDINGS, takeReviewPickupFor(WIRE_CHAPTERS[3].id, WIRE_CHAPTERS[3].title)] } : {}),
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
};
const api = import.meta.env.VITE_USE_MOCK_API === '1' ? createMockApi(window.__NARRATION_MOCK_OVERRIDES__, mockInitial) : wailsClient;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ApiProvider api={api}>
        {/* Registry core only (input-commands-and-pedals.prd.md Phase 1): mounted so it is live for later phases to
            build on, but nothing calls useCommand or CommandScope yet, so this changes no behaviour today. */}
        <CommandRouter>
          <App />
        </CommandRouter>
      </ApiProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
