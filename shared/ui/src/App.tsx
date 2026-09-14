import { useEffect, useRef, useState } from 'react';
import type { Bootstrap } from './types';
import { useApi } from './api/ApiContext';
import { AppShell } from './components/layout/AppShell';
import { StartupScreen, type StartupState } from './components/layout/StartupScreen';
import { Toast } from './components/layout/Toast';
import { ConfirmDialog } from './components/primitives/ConfirmDialog';
import { Home } from './components/home/Home';
import { Manuscript } from './components/manuscript/Manuscript';
import { Guide } from './components/storybible/Guide';
import { Transcript } from './components/proofing/Transcript';
import { Settings } from './components/settings/Settings';
import { TooltipProvider } from './components/primitives/Tooltip';
import { ErrorBoundary } from './components/primitives/ErrorBoundary';

export function App() {
  const api = useApi();
  const [data, setData] = useState<Bootstrap>();
  const [page, setPage] = useState('Home');
  const [notice, setNotice] = useState('');
  const [startup, setStartup] = useState<StartupState>('connecting');
  const [startupError, setStartupError] = useState('');
  const [diagnosticId, setDiagnosticId] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingPage, setPendingPage] = useState<string>();
  const [focusEntityId, setFocusEntityId] = useState<string>();
  const [manuscriptIntent, setManuscriptIntent] = useState<{ chapter?: string; paragraph?: number }>();
  const settingsActions = useRef<{ save: () => Promise<void>; discard: () => Promise<void> }>();

  // Startup verifies the host and then loads its bootstrap payload.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const ready = await api.ready();
        if (ready.apiVersion !== 1) throw new Error(`Desktop host API version ${ready.apiVersion} is incompatible with this UI.`);
        if (active) setDiagnosticId(ready.diagnosticId);
        const next = await api.bootstrap();
        if (active) {
          setDiagnosticId(next.diagnosticId);
          setData(next);
        }
      } catch (error) {
        const message = String(error);
        void api.reportClientDiagnostic('bootstrap_failed', message).catch(() => {});
        if (active) {
          setStartup('error');
          setStartupError(message);
        }
      }
    };
    const clientError = (event: ErrorEvent) => void api.reportClientDiagnostic('window_error', event.message).catch(() => {});
    const rejection = (event: PromiseRejectionEvent) => void api.reportClientDiagnostic('unhandled_rejection', String(event.reason)).catch(() => {});
    window.addEventListener('error', clientError);
    window.addEventListener('unhandledrejection', rejection);
    void load();
    const timeout = window.setTimeout(() => {
      if (active && !data) {
        setStartup('timeout');
        setStartupError('The desktop host did not respond within 10 seconds.');
      }
    }, 10_000);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.removeEventListener('error', clientError);
      window.removeEventListener('unhandledrejection', rejection);
    };
  }, [retryKey]);

  // Live transcript-run progress arrives over SSE instead of a 350ms client
  // poll loop - see api/httpClient.ts's subscribeTranscript / Endpoints.cs's
  // /api/transcript/events.
  useEffect(() => {
    if (!data) return;
    return api.subscribeTranscript((transcript) => setData((current) => (current ? { ...current, transcript } : current)));
  }, [data === undefined]);

  useEffect(() => {
    if (!data) return;
    const cssName: Record<string, string> = {
      color_character: '--character',
      color_location: '--place',
      color_organization: '--org',
      color_lore: '--lore',
      color_item: '--item',
      color_event: '--event',
      color_needs_review: '--review',
      color_note: '--note',
    };
    void api
      .settingsForScope('project')
      .then((settings) =>
        [...(settings.ManuscriptGuide || []), ...(settings.Manuscript || [])].forEach((field) => {
          const variable = cssName[field.key];
          if (variable && field.effectiveValue) document.documentElement.style.setProperty(variable, `#${field.effectiveValue.replace('#', '')}`);
        }),
      )
      .catch(() => {});
  }, [data === undefined]);

  if (!data)
    return (
      <StartupScreen
        state={startup}
        error={startupError}
        diagnosticId={diagnosticId}
        retry={() => {
          setStartup('connecting');
          setStartupError('');
          setRetryKey((value) => value + 1);
        }}
      />
    );

  const navigate = (next: string) => {
    if (next !== page && page === 'Settings' && settingsDirty) {
      setPendingPage(next);
      return;
    }
    if (next !== page && page === 'Proofing') void api.transcriptReset().catch(() => {});
    setPage(next);
  };

  return (
    <div className="h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      <TooltipProvider>
        <AppShell page={page} navigate={navigate} projectName={data.projectName} daw={data.daw}>
          <ErrorBoundary key={page}>
            {page === 'Home' && (
              <Home
                data={data}
                go={navigate}
                notify={setNotice}
                goToManuscript={(chapter) => {
                  setManuscriptIntent({ chapter, paragraph: 0 });
                  navigate('Manuscript');
                }}
              />
            )}
            {page === 'Manuscript' && (
              <Manuscript
                notify={setNotice}
                intent={manuscriptIntent}
                consumeIntent={() => setManuscriptIntent(undefined)}
                focusStoryBibleEntity={(id) => {
                  setFocusEntityId(id);
                  navigate('Story Bible');
                }}
              />
            )}
            {page === 'Story Bible' && (
              <Guide
                notify={setNotice}
                focusEntityId={focusEntityId}
                onFocusEntityConsumed={() => setFocusEntityId(undefined)}
                goToManuscript={(chapter, paragraph) => {
                  setManuscriptIntent({ chapter, paragraph });
                  navigate('Manuscript');
                }}
              />
            )}
            {page === 'Proofing' && (
              <Transcript
                state={data.transcript}
                notify={setNotice}
                goHome={() => navigate('Home')}
                goToManuscript={(chapter, paragraph) => {
                  setManuscriptIntent({ chapter, paragraph });
                  navigate('Manuscript');
                }}
              />
            )}
            {page === 'Settings' && (
              <Settings
                data={data}
                notify={setNotice}
                onDirtyChange={setSettingsDirty}
                registerActions={(actions) => {
                  settingsActions.current = actions;
                }}
              />
            )}
          </ErrorBoundary>
          {notice && <Toast key={notice} text={notice} dismiss={() => setNotice('')} />}
        </AppShell>
      </TooltipProvider>
      {pendingPage && (
        <ConfirmDialog
          title="Unsaved settings"
          body="Save or discard changes before leaving Settings?"
          confirmLabel="Save & continue"
          confirm={() =>
            void settingsActions.current?.save().then(() => {
              setSettingsDirty(false);
              setPage(pendingPage);
              setPendingPage(undefined);
            })
          }
          dangerLabel="Discard & continue"
          danger={() =>
            void settingsActions.current?.discard().then(() => {
              setSettingsDirty(false);
              setPage(pendingPage);
              setPendingPage(undefined);
            })
          }
          cancel={() => setPendingPage(undefined)}
        />
      )}
    </div>
  );
}
