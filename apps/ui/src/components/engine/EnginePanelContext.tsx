import { createContext, useContext, type ReactNode } from 'react';
import { Button } from '../primitives/Button';

// Opens the engine panel (stage-navigation-and-page-replacement.prd.md Phase 6, Q3 A) from anywhere in the app: the header's
// engine chip, and every "fix this link" pointer that used to send the narrator to the Tracks page. App.tsx owns the one
// panel and provides this; without a provider (a component test) the pointers render and do nothing.
const EnginePanelContext = createContext<(() => void) | null>(null);

export const EnginePanelProvider = EnginePanelContext.Provider;

export function useOpenEnginePanel(): () => void {
  return useContext(EnginePanelContext) ?? noop;
}

function noop() {}

/** An inline "Open the audio engine panel" pointer, drawn like the text links it replaces ("Open Tracks"). */
export function EnginePanelLink({ className = 'font-semibold', children = 'Open the audio engine panel' }: { className?: string; children?: ReactNode }) {
  const open = useOpenEnginePanel();
  return (
    <Button variant="link" className={className} onClick={open}>
      {children}
    </Button>
  );
}
