import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { wailsClient } from './api/wailsClient';
import { createMockApi } from './api/mockApi';
import { ThemeProvider } from './theme/ThemeContext';
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
// `?mockNoManuscript=1` boots a project with no manuscript imported yet, so
// Home shows its manuscript-not-found banner and Proofing/Story Bible are locked.
const mockNoManuscript = mockParams.has('mockNoManuscript');
// `?mockManuscriptCandidate=1` boots a project with no imported manuscript but a
// manuscript.docx in its folder, so Home shows the import offer.
const mockManuscriptCandidate = mockParams.has('mockManuscriptCandidate');
// `?mockTeleprompter=listening|waiting|done` boots the teleprompter already part-way
// through the first chapter, as a session the host kept running.
const mockTeleprompter = (['listening', 'waiting', 'done'] as const).find((seed) => seed === mockParams.get('mockTeleprompter'));
// `?mockPreviewError=<text>` makes the Story Bible preview fail with that text once the
// preview voice is installed, so the failure toast can be seen without a real host.
const mockPreviewError = mockParams.get('mockPreviewError');
// `?mockInvalidPayload=bootstrap|manuscript|storybible` makes that payload arrive in the wrong shape (through the real `parseWire`),
// so the startup error screen and the inline page errors for a payload the app could not read can be seen without a host.
const mockInvalidPayload = (['bootstrap', 'manuscript', 'storybible'] as const).find((which) => which === mockParams.get('mockInvalidPayload'));
// `?mockLiveDegraded=1` tells the app at once that live updates are degraded, so the notice can be seen without a failing host.
const mockLiveDegraded = mockParams.has('mockLiveDegraded');
// `?mockUpdate=available|found|downloading|download-fails|ready|install-blocked|install-refused|failed|current|development` boots the mock host in that update state ("Version 0.2.7 is available", "could not reach
// GitHub", "up to date", a development build), so the About and updates page can be seen without GitHub. `found` also notifies at once.
const mockUpdate = (
  ['available', 'found', 'downloading', 'download-fails', 'ready', 'install-blocked', 'install-refused', 'failed', 'current', 'development'] as const
).find((seed) => seed === mockParams.get('mockUpdate'));
const mockInitial = {
  ...(mockUpdate ? { update: mockUpdate } : {}),
  ...(mockLiveDegraded ? { liveUpdatesDegraded: true } : {}),
  ...(mockInvalidPayload ? { invalidPayload: mockInvalidPayload } : {}),
  ...(mockNoManuscript ? { noManuscript: true } : {}),
  ...(mockPreviewError ? { previewError: mockPreviewError } : {}),
  ...(mockTeleprompter ? { teleprompter: mockTeleprompter } : {}),
  ...(mockNoProject ? { projectFolder: '' } : {}),
  ...(mockMultipleRpp ? { tracksCandidates: ['C:/Projects/Alice-in-Wonderland/Alice.rpp', 'C:/Projects/Alice-in-Wonderland/Alice-alt-mix.rpp'] } : {}),
  ...(mockNoRpp ? { tracksCandidates: [] } : {}),
  ...(mockManuscriptCandidate ? { manuscriptCandidate: { path: 'C:/Projects/Alice-in-Wonderland/manuscript.docx', name: 'manuscript.docx' } } : {}),
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
