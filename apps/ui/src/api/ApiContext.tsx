import { createContext, useContext, type ReactNode } from 'react';
import type { NarrationApi } from '../types';

// The single injection point for the backend service layer: every component
// that needs data calls useApi() instead of importing a transport (or,
// previously, reaching for a window.pywebview global) directly. Swapping the
// whole app onto a mock is then a one-line change at the provider, in tests
// or in the browser-only dev mode (see main.tsx).
const ApiContext = createContext<NarrationApi | undefined>(undefined);

export function ApiProvider({ api, children }: { api: NarrationApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): NarrationApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi() called outside an <ApiProvider>.');
  return api;
}
