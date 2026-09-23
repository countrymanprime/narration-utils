import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { wailsClient } from './api/wailsClient';
import { createMockApi } from './api/mockApi';
import { WIRE_CHAPTERS } from './api/mockFixtures';
import { COVERAGE_REFUSAL_REASONS } from './api/schemas/coverage';
import { ThemeProvider } from './theme/ThemeContext';
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
// `?mockNoManuscript=1` boots a project with no manuscript imported yet, so
// Home shows its manuscript-not-found banner and Proofing/Story Bible are locked.
const mockNoManuscript = mockParams.has('mockNoManuscript');
// `?mockManuscriptCandidate=1` boots a project with no imported manuscript but a
// manuscript.docx in its folder, so Home shows the import offer.
const mockManuscriptCandidate = mockParams.has('mockManuscriptCandidate');
// `?mockTeleprompter=listening|waiting|done` boots the teleprompter already part-way
// through the first chapter, as a session the host kept running; `ended` boots one that
// already stopped itself at the end of the chapter (the host's auto-stop).
const mockTeleprompter = (['listening', 'waiting', 'done', 'ended'] as const).find((seed) => seed === mockParams.get('mockTeleprompter'));
// `?mockNoDevices=1` boots the teleprompter with an empty device listing, so the
// blocked "No microphone found" state (no typed fallback) can be seen without a host.
const mockNoDevices = mockParams.has('mockNoDevices');
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
// `?mockImportPreview=markdown|repaired` makes the next manuscript import a Markdown file (so the chapter heading level choice can be seen in the review dialog) or a
// Word file whose headings the importer had to repair (so the repairs note can).
const mockImportPreview = (['markdown', 'repaired'] as const).find((kind) => kind === mockParams.get('mockImportPreview'));
// `?mockChapterLink=missing` seeds the first chapter with a confirmed link to a track GUID that is not in the mock
// REAPER project, so the Tracks page's "Track missing" state can be seen without confirming and then deleting a
// track first (analysis evidence ledger PRD, Phase 7).
const mockChapterLinkMissing = mockParams.get('mockChapterLink') === 'missing';
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
// `?mockChapterTags=ready|not-rendered` boots the Tracks page's "Embed chapter tags" dialog with ChapterTagsPreview
// already at that result, so the ready and not-yet-rendered states can be seen without a real chapter render.
// `?mockChapterTagsEmbedError=1` makes the embed action always fail, so the error state can be seen too.
const mockChapterTags = (['ready', 'not-rendered'] as const).find((seed) => seed === mockParams.get('mockChapterTags'));
const mockChapterTagsEmbedError = mockParams.has('mockChapterTagsEmbedError');
// `?mockCoverage=hold|stale` holds a started recording check at its last transcribing step (so the running dialog can be seen), or
// makes Chapter 4's stored check read stale (an item was trimmed since), and `?mockCoverageRefusal=<reason>` answers every start
// with that refusal (recording-coverage-analysis.prd.md Phase 6).
const mockCoverage = (['hold', 'stale'] as const).find((seed) => seed === mockParams.get('mockCoverage'));
const mockCoverageRefusal = COVERAGE_REFUSAL_REASONS.find((reason) => reason === mockParams.get('mockCoverageRefusal'));
const mockInitial = {
  ...(mockImportPreview ? { importPreview: mockImportPreview } : {}),
  ...(mockAssets ? { assets: mockAssets } : {}),
  ...(mockUpdate ? { update: mockUpdate } : {}),
  ...(mockLiveDegraded ? { liveUpdatesDegraded: true } : {}),
  ...(mockRebuildRunning ? { rebuildRunning: true } : {}),
  ...(mockHoldEdits ? { holdEdits: true } : {}),
  ...(mockInvalidPayload ? { invalidPayload: mockInvalidPayload } : {}),
  ...(mockNoManuscript ? { noManuscript: true } : {}),
  ...(mockNoDaw ? { dawFileLinked: false } : {}),
  ...(mockDawNotDetected ? { dawCatalogInstalled: false } : {}),
  ...(mockPreviewError ? { previewError: mockPreviewError } : {}),
  ...(mockTeleprompter ? { teleprompter: mockTeleprompter } : {}),
  ...(mockNoDevices ? { teleprompterDevices: [] } : {}),
  ...(mockNoProject ? { projectFolder: '' } : {}),
  ...(mockMultipleRpp ? { tracksCandidates: ['C:/Projects/Alice-in-Wonderland/Alice.rpp', 'C:/Projects/Alice-in-Wonderland/Alice-alt-mix.rpp'] } : {}),
  ...(mockNoRpp ? { tracksCandidates: [] } : {}),
  ...(mockManuscriptCandidate ? { manuscriptCandidate: { path: 'C:/Projects/Alice-in-Wonderland/manuscript.docx', name: 'manuscript.docx' } } : {}),
  ...(mockChapterLinkMissing
    ? {
        chapterTrackMappings: [
          { trackGuid: '{NOT-A-REAL-TRACK-GUID}', chapterId: WIRE_CHAPTERS[0].id, chapterTitle: WIRE_CHAPTERS[0].title, confirmedAt: '2026-09-01T12:00:00Z' },
        ],
      }
    : {}),
  ...(mockLineIdentity ? { lineIdentity: mockLineIdentity } : {}),
  ...(mockPickups ? { pickups: mockPickups } : {}),
  ...(mockRenderConfig ? { renderConfig: mockRenderConfig } : {}),
  ...(mockChapterTags ? { chapterTags: mockChapterTags } : {}),
  ...(mockChapterTagsEmbedError ? { chapterTagsEmbedAlwaysErrors: true } : {}),
  ...(mockCoverage || mockCoverageRefusal
    ? {
        coverage: {
          ...(mockCoverage === 'hold' ? { hold: true } : {}),
          ...(mockCoverage === 'stale' ? { stale: [WIRE_CHAPTERS[3].id] } : {}),
          ...(mockCoverageRefusal ? { refusal: mockCoverageRefusal } : {}),
        },
      }
    : {}),
};
const api = import.meta.env.VITE_USE_MOCK_API === '1' ? createMockApi(window.__NARRATION_MOCK_OVERRIDES__, mockInitial) : wailsClient;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ApiProvider api={api}>
        <App />
      </ApiProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
