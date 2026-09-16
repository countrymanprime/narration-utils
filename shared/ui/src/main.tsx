import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { httpClient } from './api/httpClient';
import { createMockApi } from './api/mockApi';
import './styles.css';

// Mock mode runs the complete UI in a browser without the desktop host.
//
// Visual tests set mock overrides before the app starts.
declare global {
  interface Window {
    __NARRATION_MOCK_OVERRIDES__?: Parameters<typeof createMockApi>[0];
  }
}
const api = import.meta.env.VITE_USE_MOCK_API === '1' ? createMockApi(window.__NARRATION_MOCK_OVERRIDES__) : httpClient;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ApiProvider api={api}>
      <App />
    </ApiProvider>
  </React.StrictMode>,
);
