import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<Bootstrap>();
  const [notice, setNotice] = useState('');
  const [startup, setStartup] = useState<StartupState>('connecting');
  const [startupError, setStartupError] = useState('');
  const [diagnosticId, setDiagnosticId] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingPath, setPendingPath] = useState<string>();
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

  // Deep links are expressed as a URL anchor on the fixed page path, not as
  // path params - "#p123" points at paragraph 123 (its globally unique
  // index, assigned when the manuscript is imported), "#cChapter Title" at a
  // chapter with no specific line, and "#<entityId>" at a Story Bible entry.
  // See Manuscript.tsx/Guide.tsx for where these are consumed.
  const goToManuscript = (chapter: string, paragraph?: number) =>
    guardedNavigate(`/manuscript#${paragraph !== undefined ? `p${paragraph}` : `c${encodeURIComponent(chapter)}`}`);
  const goToStoryBible = (entityId: string) => guardedNavigate(`/story-bible#${encodeURIComponent(entityId)}`);

  const guardedNavigate = (next: string) => {
    const nextPath = next.split('#')[0] || '/';
    if (nextPath !== location.pathname && location.pathname === '/settings' && settingsDirty) {
      setPendingPath(next);
      return;
    }
    if (nextPath !== location.pathname && location.pathname === '/proofing') void api.transcriptReset().catch(() => {});
    navigate(next);
  };

  return (
    <div className="h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      <TooltipProvider>
        <AppShell pathname={location.pathname} navigate={guardedNavigate} projectName={data.projectName} daw={data.daw}>
          <ErrorBoundary key={location.pathname.split('/')[1] || 'home'}>
            <Routes>
              <Route path="/" element={<Home data={data} go={guardedNavigate} notify={setNotice} goToManuscript={goToManuscript} />} />
              <Route path="/manuscript" element={<Manuscript notify={setNotice} focusStoryBibleEntity={goToStoryBible} />} />
              <Route path="/story-bible" element={<Guide notify={setNotice} goToManuscript={goToManuscript} />} />
              <Route
                path="/proofing"
                element={
                  <Transcript state={data.transcript} notify={setNotice} goHome={() => guardedNavigate('/')} goToManuscript={goToManuscript} />
                }
              />
              <Route
                path="/settings"
                element={
                  <Settings
                    data={data}
                    notify={setNotice}
                    onDirtyChange={setSettingsDirty}
                    registerActions={(actions) => {
                      settingsActions.current = actions;
                    }}
                  />
                }
              />
            </Routes>
          </ErrorBoundary>
          {notice && <Toast key={notice} text={notice} dismiss={() => setNotice('')} />}
        </AppShell>
      </TooltipProvider>
      {pendingPath && (
        <ConfirmDialog
          title="Unsaved settings"
          body="Save or discard changes before leaving Settings?"
          confirmLabel="Save & continue"
          confirm={() =>
            void settingsActions.current?.save().then(() => {
              setSettingsDirty(false);
              navigate(pendingPath);
              setPendingPath(undefined);
            })
          }
          dangerLabel="Discard & continue"
          danger={() =>
            void settingsActions.current?.discard().then(() => {
              setSettingsDirty(false);
              navigate(pendingPath);
              setPendingPath(undefined);
            })
          }
          cancel={() => setPendingPath(undefined)}
        />
      )}
    </div>
  );
}
