import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Bootstrap } from './types';
import { useApi } from './api/ApiContext';
import { AppShell } from './components/layout/AppShell';
import { StartupScreen, type StartupState } from './components/layout/StartupScreen';
import { Toast } from './components/layout/Toast';
import { ConfirmDialog } from './components/primitives/ConfirmDialog';
import { Home } from './components/home/Home';
import { Manuscript } from './components/manuscript/Manuscript';
import { ProjectPicker } from './components/project/ProjectPicker';
import { Guide } from './components/storybible/Guide';
import { Transcript } from './components/proofing/Transcript';
import { Settings } from './components/settings/Settings';
import { TooltipProvider } from './components/primitives/Tooltip';
import { ErrorBoundary } from './components/primitives/ErrorBoundary';
import { DESKTOP_HOST_API_VERSION } from './hostApi';

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
  const hasBootstrap = data !== undefined;

  // Importing changes data that is deliberately held at the application
  // boundary (the active manuscript affects several pages).  Refresh this
  // payload in place instead of reloading the browser, which could interrupt
  // the completion dialog before its activity log is visible.
  const refreshBootstrap = useCallback(async () => {
    const next = await api.bootstrap();
    setDiagnosticId(next.diagnosticId);
    setData(next);
  }, [api]);

  // Startup verifies the host and then loads its bootstrap payload.
  useEffect(() => {
    let active = true;
    let loaded = false;
    const load = async () => {
      try {
        const ready = await api.ready();
        if (ready.apiVersion !== DESKTOP_HOST_API_VERSION) throw new Error(`Desktop host API version ${ready.apiVersion} is incompatible with this UI.`);
        if (active) setDiagnosticId(ready.diagnosticId);
        const next = await api.bootstrap();
        if (active) {
          loaded = true;
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
      if (active && !loaded) {
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
  }, [retryKey, api]);

  // Transcript state arrives through one native Wails event subscription.
  useEffect(() => {
    if (!hasBootstrap) return;
    return api.subscribeTranscript((transcript) => setData((current) => (current ? { ...current, transcript } : current)));
  }, [api, hasBootstrap]);

  // Wails forwards a second REAPER launch to the existing native window. The
  // host replaces project-scoped services only after proving it is idle, then
  // this one subscription refreshes the shared application bootstrap.
  useEffect(() => {
    if (!hasBootstrap) return;
    return api.subscribeProjectAttach((state) => {
      if (state.attached) void refreshBootstrap();
      else if (state.reason) setNotice(state.reason);
    });
  }, [api, hasBootstrap, refreshBootstrap]);

  useEffect(() => {
    if (!hasBootstrap) return;
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
  }, [api, hasBootstrap]);

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

  // A standalone launch (Start Menu shortcut, taskbar pin) has no
  // REAPER-supplied project, so Bootstrap() returns a populated payload with
  // an empty projectFolder rather than null. subscribeProjectAttach (above)
  // already refreshes `data` once ProjectPicker's switch/create succeeds, so
  // no callback needs to be threaded through here.
  if (!data.projectFolder) return <ProjectPicker />;

  // Deep links are expressed as a URL anchor on the fixed page path, not as
  // path params - "#p123" points at paragraph 123 (its globally unique
  // index, assigned when the manuscript is imported), "#c<chapter-id>" at a
  // chapter with no specific line, and "#<entityId>" at a Story Bible entry.
  // See Manuscript.tsx/Guide.tsx for where these are consumed.
  const goToManuscript = (chapter: string, paragraph?: number) =>
    guardedNavigate(`/manuscript#${paragraph !== undefined ? `p${paragraph}` : `c${encodeURIComponent(chapter)}`}`);
  const goToStoryBible = (entityId: string) => guardedNavigate(`/story-bible#${encodeURIComponent(entityId)}`);

  const guardedNavigate = (next: string) => {
    const nextPath = next.split('#')[0] || '/';
    if (!data.manuscript && ['/manuscript', '/proofing', '/story-bible'].includes(nextPath)) {
      navigate('/', { replace: true });
      return;
    }
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
        <AppShell
          pathname={location.pathname}
          navigate={guardedNavigate}
          projectName={data.projectName}
          daw={data.daw}
          hasManuscript={Boolean(data.manuscript)}
        >
          <ErrorBoundary key={location.pathname.split('/')[1] || 'home'}>
            <Routes>
              <Route
                path="/"
                element={<Home data={data} go={guardedNavigate} notify={setNotice} goToManuscript={goToManuscript} refreshBootstrap={refreshBootstrap} />}
              />
              <Route
                path="/manuscript"
                element={data.manuscript ? <Manuscript notify={setNotice} focusStoryBibleEntity={goToStoryBible} /> : <Navigate to="/" replace />}
              />
              <Route
                path="/story-bible"
                element={data.manuscript ? <Guide notify={setNotice} goToManuscript={goToManuscript} /> : <Navigate to="/" replace />}
              />
              <Route
                path="/proofing"
                element={
                  data.manuscript ? (
                    <Transcript state={data.transcript} notify={setNotice} goHome={() => guardedNavigate('/')} goToManuscript={goToManuscript} />
                  ) : (
                    <Navigate to="/" replace />
                  )
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
                    onProjectDataCleared={async () => {
                      await refreshBootstrap();
                      guardedNavigate('/');
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
