import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Bootstrap } from './types';
import { useApi } from './api/ApiContext';
import { AppShell } from './components/layout/AppShell';
import { StartupScreen, type StartupState } from './components/layout/StartupScreen';
import { ToastRegion } from './components/primitives/Toast';
import { useToasts } from './hooks/useToasts';
import { usePendingAction } from './hooks/usePendingAction';
import { notificationForJobEnd, shouldNotifyForJobEnd, toastForJobEnd } from './jobEnded';
import { ConfirmDialog } from './components/primitives/ConfirmDialog';
import { Home } from './components/home/Home';
import { Manuscript } from './components/manuscript/Manuscript';
import { ProjectPicker } from './components/project/ProjectPicker';
import { Guide } from './components/storybible/Guide';
import { Transcript } from './components/proofing/Transcript';
import { Settings } from './components/settings/Settings';
import { TeleprompterPage } from './components/teleprompter/TeleprompterPage';
import { TracksPage } from './components/tracks/TracksPage';
import { TooltipProvider } from './components/primitives/Tooltip';
import { ErrorBoundary } from './components/primitives/ErrorBoundary';
import { DESKTOP_HOST_API_VERSION } from './hostApi';
import { isWireError } from './api/wire/WireError';
import { describeApiError } from './api/errorMessage';

const LIVE_UPDATES_DEGRADED = 'Some live updates from the desktop host could not be read, so what you see may be out of date. Reopen the page to refresh it.';

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
  // One queue for the whole app: messages stack instead of replacing each other, an identical one that is showing starts its time again, and
  // an error stays until it is dismissed (ADR 0075). `notify` and `dismiss` keep their identity, so a page effect that lists them never re-runs.
  const { messages, notify: setNotice, dismiss: dismissMessage } = useToasts();
  const [startup, setStartup] = useState<StartupState>('connecting');
  const [startupError, setStartupError] = useState('');
  const [startupDetails, setStartupDetails] = useState<string>();
  const [diagnosticId, setDiagnosticId] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingPath, setPendingPath] = useState<string>();
  const settingsActions = useRef<{ save: () => Promise<void>; discard: () => Promise<void> } | undefined>(undefined);
  const hasBootstrap = data !== undefined;

  // Importing changes data that is deliberately held at the application
  // boundary (the active manuscript affects several pages).  Refresh this
  // payload in place instead of reloading the browser, which could interrupt
  // the completion dialog before its activity log is visible.
  const refreshBootstrap = useCallback(async () => {
    try {
      const next = await api.bootstrap();
      setDiagnosticId(next.diagnosticId);
      setData(next);
    } catch (error) {
      // Every caller runs this from an event or a `void`, so a failure has nowhere to go but the narrator.
      setNotice(describeApiError(error), 'error');
    }
  }, [api, setNotice]);

  // The one shared "link a REAPER project file" action behind the header pill, the Tracks page and Settings' DAW
  // category (PRD project-workspace-and-daw-link.prd.md, Open Question W19). Cancelling the dialog does nothing; a
  // folder mismatch is refused with its own message rather than silently re-pointing the project (W15). One
  // `usePendingAction` ref guards all three call sites at once (ADR 0075), since the host's file dialog is native
  // and modal - a second press from any of them while it is open is refused, not just the button that shows it.
  const dawLink = usePendingAction();
  const linkDawFile = useCallback(async () => {
    await dawLink.run('link-daw', async () => {
      try {
        const result = await api.linkDawFile();
        if (!result.selected) return;
        if (!result.linked) {
          setNotice(result.message || 'That REAPER project file could not be linked.', 'error');
          return;
        }
        await refreshBootstrap();
        setNotice('REAPER project linked.');
      } catch (error) {
        setNotice(describeApiError(error), 'error');
      }
    });
  }, [api, dawLink, refreshBootstrap, setNotice]);

  // Startup verifies the host and then loads its bootstrap payload.
  useEffect(() => {
    let active = true;
    let loaded = false;
    let failed = false;
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
        // A payload that did not match its schema says so in plain words and keeps the technical text for "Copy details"
        // (ADR 0069); the client has already written it to the host log, so it is not reported a second time.
        const wire = isWireError(error);
        const message = wire ? error.userMessage : String(error);
        if (!wire) void api.reportClientDiagnostic('bootstrap_failed', message).catch(() => {});
        failed = true;
        if (active) {
          setStartup('error');
          setStartupError(message);
          setStartupDetails(wire ? error.details() : undefined);
        }
      }
    };
    const clientError = (event: ErrorEvent) => void api.reportClientDiagnostic('window_error', event.message).catch(() => {});
    const rejection = (event: PromiseRejectionEvent) => void api.reportClientDiagnostic('unhandled_rejection', String(event.reason)).catch(() => {});
    window.addEventListener('error', clientError);
    window.addEventListener('unhandledrejection', rejection);
    void load();
    const timeout = window.setTimeout(() => {
      if (active && !loaded && !failed) {
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

  // The host tells the narrator what it did on their behalf, such as keeping a file it could not read (ADR 0069).
  useEffect(() => {
    if (!hasBootstrap) return;
    return api.subscribeNotices(setNotice);
  }, [api, hasBootstrap, setNotice]);

  // A host job that ends is announced from here, so leaving the page that started it loses nothing (ADR 0076). The same
  // event decides whether it is also worth an OS notification (N1-N4): document.hasFocus() is read fresh for each job,
  // here, because it is the webview's to know, not the host's.
  useEffect(() => {
    if (!hasBootstrap) return;
    return api.subscribeJobEnded((event) => {
      const announcement = toastForJobEnd(event);
      if (announcement) setNotice(announcement.text, announcement.tone);
      if (shouldNotifyForJobEnd(event, document.hasFocus())) {
        const { title, body } = notificationForJobEnd(event);
        void api.systemNotify(event.kind, title, body);
      }
    });
  }, [api, hasBootstrap, setNotice]);

  // A check the app makes on its own found a release newer than this build (ADR 0072): the narrator is told once, and Settings > About
  // and updates says the rest. Nothing is downloaded until they ask.
  useEffect(() => {
    if (!hasBootstrap) return;
    return api.subscribeUpdate((status) => {
      if (status.available) setNotice(`Version ${status.available.version} is available. See Settings, About & updates.`);
    });
  }, [api, hasBootstrap, setNotice]);

  // Live events that do not match their schema are dropped and counted (ADR 0069); after a run of them the page on screen may be
  // out of date, and the narrator is told once instead of being left with a page that silently stopped updating.
  useEffect(() => {
    if (!hasBootstrap) return;
    return api.subscribeLiveUpdateHealth(() => setNotice(LIVE_UPDATES_DEGRADED));
  }, [api, hasBootstrap, setNotice]);

  // Wails forwards a second REAPER launch to the existing native window. The
  // host replaces project-scoped services only after proving it is idle, then
  // this one subscription refreshes the shared application bootstrap.
  useEffect(() => {
    if (!hasBootstrap) return;
    return api.subscribeProjectAttach((state) => {
      if (state.attached) void refreshBootstrap();
      else if (state.reason) setNotice(state.reason);
    });
  }, [api, hasBootstrap, refreshBootstrap, setNotice]);

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
        details={startupDetails}
        diagnosticId={diagnosticId}
        retry={() => {
          setStartup('connecting');
          setStartupError('');
          setStartupDetails(undefined);
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
    if (!data.manuscript && ['/manuscript', '/proofing', '/story-bible', '/teleprompter'].includes(nextPath)) {
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
          hasManuscript={Boolean(data.manuscript)}
          dawFileLinked={data.dawFileLinked}
          onLinkDawFile={() => void linkDawFile()}
          linkingDawFile={dawLink.isBusy}
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
                    <Transcript
                      state={data.transcript}
                      notify={setNotice}
                      goHome={() => guardedNavigate('/')}
                      goToManuscript={goToManuscript}
                      dawFileLinked={data.dawFileLinked}
                    />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route path="/teleprompter" element={data.manuscript ? <TeleprompterPage /> : <Navigate to="/" replace />} />
              <Route path="/tracks" element={<TracksPage dawFileLinked={data.dawFileLinked} onLinkDawFile={() => void linkDawFile()} />} />
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
                    onLinkDawFile={() => void linkDawFile()}
                  />
                }
              />
            </Routes>
          </ErrorBoundary>
          <ToastRegion messages={messages} dismiss={dismissMessage} />
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
