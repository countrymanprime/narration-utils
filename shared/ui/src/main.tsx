import React from 'react';
import { config } from '@fortawesome/fontawesome-svg-core';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { wailsClient } from './api/wailsClient';
import { createMockApi } from './api/mockApi';
import { ThemeProvider } from './theme/ThemeContext';
import './styles.css';

// styles.css loads FontAwesome's CSS itself (inside a cascade layer).
config.autoAddCss = false;

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
const mockNoProject = new URLSearchParams(window.location.search).has('mockNoProject');
const api =
  import.meta.env.VITE_USE_MOCK_API === '1'
    ? createMockApi(window.__NARRATION_MOCK_OVERRIDES__, mockNoProject ? { projectFolder: '' } : undefined)
    : wailsClient;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ApiProvider api={api}>
        <App />
      </ApiProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
