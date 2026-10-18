import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Bootstrap } from './types';
import { useApi } from './api/ApiContext';
import { AppShell, shellPages } from './components/layout/AppShell';
import { openJumpMenu } from './components/layout/JumpMenu';
import { openHistoryPanel } from './components/layout/HistoryPanel';
import { useGoToCommands } from './components/layout/useGoToCommands';
import { useJournalEntries } from './components/layout/useJournalEntries';
import { OverlayProvider, useOverlay } from './overlay/OverlayProvider';
import { dawShortName, StudioProvider, useJournal, useStoreHandle, useStudio } from './studio/StudioProvider';
import type { Journal } from './studio/journal/createJournal';
import { MANUSCRIPT_CHANGED } from './studio/slots';
import type { ContextMenuItem } from './components/primitives/ContextMenu';
import type { ManuscriptChapter } from './api/contracts/manuscript';
import { useDawKind } from './useDawKind';
import { useTheme } from './theme/ThemeContext';
import { useUserKeymap } from './input/useUserKeymap';
import { useNavCounts } from './components/layout/useNavCounts';
import { StartupScreen, type StartupState } from './components/layout/StartupScreen';
import { ToastRegion, type ToastTone } from './components/primitives/Toast';
import { useToasts } from './hooks/useToasts';
import { useChapterSync } from './hooks/useChapterSync';
import { usePendingAction } from './hooks/usePendingAction';
import { ChapterSyncConsentDialog } from './components/engine/ChapterSyncConsentDialog';
import type { ChapterSyncPreview } from './api/contracts/chapterSync';
import { useAppHistory } from './hooks/useAppHistory';
import { useZoom } from './hooks/useZoom';
import { notificationForJobEnd, shouldNotifyForJobEnd, shouldQueueJobEndAnnouncement, toastForJobEnd } from './jobEnded';
import { useBoothRecording } from './components/booth/useBoothRecording';
import { ConfirmDialog } from './components/primitives/ConfirmDialog';
import { ShortcutSheet } from './components/help/ShortcutSheet';
import { ScriptPage } from './components/script/page/ScriptPage';
import { creditsKindOfId } from './components/credits/creditsEntries';
import { NeedManuscript } from './components/layout/NeedManuscript';
import { ProjectPicker } from './components/project/ProjectPicker';
import { Guide } from './components/storybible/Guide';
import { SettingsPage } from './components/settings/page/SettingsPage';
import { BoothNextPage } from './components/booth/page/BoothNextPage';
import { type BoothTarget } from './components/booth/page/boothQuery';
import { addressPagePath, addressPath, type AddressPage } from './navigation/address';
import { scriptPath } from './navigation/scriptPath';
import { AddressGate } from './components/layout/AddressGate';
import { NotFoundPage } from './components/layout/NotFoundPage';
import { CompanionPage } from './components/booth/companion/CompanionPage';
import { EnginePanel } from './components/engine/EnginePanel';
import { EnginePanelProvider } from './components/engine/EnginePanelContext';
import { RetiredTracksRoute } from './components/engine/RetiredTracksRoute';
import { ProofChapterPage } from './components/proof/ProofChapterPage';
import { ProofPage } from './components/proof/ProofPage';
import { EditingPage } from './components/editing/EditingPage';
import type { DrawerTab } from './components/editing/drawer/drawerTabs';
import { PickupsPage } from './components/pickups/PickupsPage';
import { RedirectKeepingLocation } from './components/layout/RedirectKeepingLocation';
import { leavesCompareRun } from './components/proof/leavesCompareRun';
import { MasterPage } from './components/masterqc/page/MasterPage';
import { DeliveryPage } from './components/delivery/page/DeliveryPage';
import { parseMasterHash } from './components/master/masterLink';
import { ProductionPage } from './components/production/ProductionPage';
import { SchedulePage } from './components/schedule/SchedulePage';
import { runningTimerOf, type RunningTimer } from './components/layout/TimerChip';
import type { ProductionOverview } from './api/contracts/production';
import { TooltipProvider } from './components/primitives/Tooltip';
import { ErrorBoundary } from './components/primitives/ErrorBoundary';
import { DESKTOP_HOST_API_VERSION } from './hostApi';
import { isWireError } from './api/wire/WireError';
import { describeApiError } from './api/errorMessage';
import { useCommand } from './input/useCommand';
import { useRecordingEngine } from './components/booth/useRecorder';

// The kept Settings categories another page can open Settings at, by URL anchor (`#cleanup` is Master's Silence cleanup link).
// `#teleprompter` is kept as an alias of `#booth` so links from before the Booth replaced the Teleprompter page still land;
// the category's key stays its settings tool's name.
const SETTINGS_ANCHORS: Record<string, string> = {
  '#recording': 'Recording',
  '#credits': 'Credits',
  '#delivery': 'Delivery',
  '#cleanup': 'Cleanup',
  '#booth': 'Teleprompter',
  '#teleprompter': 'Teleprompter',
};

const NO_CHAPTERS: ManuscriptChapter[] = [];

/** The least time between two re-reads of the DAW's facts that a window focus may cause. */
const DAW_FACTS_FOCUS_MS = 2_000;

const LIVE_UPDATES_DEGRADED = 'Some live updates from the desktop host could not be read, so what you see may be out of date. Reopen the page to refresh it.';

// `nav.back`/`nav.forward`'s dialog check: only the shortcut sheet wraps its content in
// `<CommandScope kind="dialog">` (ShortcutSheet.tsx), so for every other dialog the `dialog` scope never goes active and
// the router's own scope resolution would let Back/Forward fire over an open dialog. Kept as a direct check until
// dialogs claim the scope generically.
const isModalOpen = () => Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));

// A `popstate` the app did not start (the keyboard's or the system's Back) from dirty Settings is stopped before the router sees it: once
// the route changed, Settings would unmount and its edits be gone before any prompt. History is put back where it was and the same
// "Unsaved settings" prompt asks. The listener is added when this module loads, ahead of the router's own, which React Router adds
// when it mounts: listeners of one event run in the order they were added.
const popGuard = {
  dirty: false,
  pathname: '',
  idx: 0,
  swallow: false,
  isOwnPop: (): boolean => false,
  ask: null as ((direction: 1 | -1) => void) | null,
};
const historyIdx = () => (window.history.state as { idx?: number } | null)?.idx ?? 0;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => {
    if (popGuard.swallow) {
      popGuard.swallow = false;
      event.stopImmediatePropagation();
      return;
    }
    const next = historyIdx();
    if (!popGuard.ask || popGuard.isOwnPop() || !popGuard.dirty || popGuard.pathname !== '/settings' || window.location.pathname.endsWith('/settings')) {
      popGuard.idx = next;
      return;
    }
    event.stopImmediatePropagation();
    const delta = next - popGuard.idx;
    popGuard.swallow = true;
    window.history.go(-delta);
    popGuard.ask(delta < 0 ? -1 : 1);
  });
}

export function App({ journal }: { journal?: Journal } = {}) {
  // Every build except the demo serves from the site root (base: '/', vite.config.ts), so this is a
  // no-op basename there. The demo serves under /narration-utils/demo/: without a matching basename
  // react-router compares its routes ('/', '/proof', ...) against the full pathname and matches
  // nothing, so every page renders blank apart from the app shell (found by loading the built demo
  // and reading the console: "No routes matched location ...").
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {/* The journal and the overlay host are mounted once, here: a page asks the overlay for a confirm, a dialog or a toast by calling the service. */}
      <StudioProvider journal={journal}>
        {/* Positioned, so the host's visually hidden announcer lays out against the app and not the document. */}
        <div className="relative h-full">
          <OverlayProvider>
            <AppRoutes />
          </OverlayProvider>
        </div>
      </StudioProvider>
    </BrowserRouter>
  );
}

// A pending guarded move, either a path (the nav, a "go to" link) or a Back/Forward delta; the two guards below
// (unsaved Settings, leaving a Proof chapter view with a run) apply to both the same way (`guardedNavigate` and
// `attemptDelta` in `App`).
type PendingMove = { kind: 'path'; path: string } | { kind: 'delta'; direction: 1 | -1 };

function AppRoutes() {
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const history = useAppHistory();
  const zoom = useZoom(api);
  const journal = useJournal();
  const overlay = useOverlay();
  const dawKind = useDawKind();
  const theme = useTheme();
  const toggleTheme = () => theme.setPreference(theme.resolved === 'dark' ? 'light' : 'dark');
  const keymap = useUserKeymap();
  const journalRows = useJournalEntries(journal);
  // The latest guarded back/forward, read by the one document-level listener below (mounted once) instead
  // of resubscribing it on every render.
  const guardedBackRef = useRef<() => void>(() => {});
  const guardedForwardRef = useRef<() => void>(() => {});
  const prevPathnameRef = useRef(location.pathname);
  // The page the last move left. `unexpectedPop` is set one render after the location changes, by which time
  // `prevPathnameRef` already holds the new page.
  const leftPathnameRef = useRef(location.pathname);
  // The compare run's phase, read by the pop-recovery effect below without resubscribing it on every transcript event.
  const transcriptPhaseRef = useRef<string>('idle');
  const [data, setData] = useState<Bootstrap>();
  const hasManuscript = Boolean(data?.manuscript);
  // One queue for the whole app: messages stack instead of replacing each other, an identical one that is showing starts its time again, and
  // an error stays until it is dismissed. `notify` and `dismiss` keep their identity, so a page effect that lists them never re-runs.
  const { messages, notify: setNotice, dismiss: dismissMessage } = useToasts();
  // Chapter sync's consent: read here, once, so "Sync chapters to
  // tracks?" shows from every link path (the engine panel, an import, an attach) wherever the narrator happens to be.
  const chapterSync = useChapterSync(api);
  const [syncPreview, setSyncPreview] = useState<ChapterSyncPreview>();
  const [syncBusy, setSyncBusy] = useState(false);
  useEffect(() => {
    if (!chapterSync?.ask) {
      setSyncPreview(undefined);
      return;
    }
    let active = true;
    void api
      .chapterSyncPreview()
      .then((preview) => {
        if (active) setSyncPreview(preview);
      })
      .catch((error) => setNotice(describeApiError(error), 'error'));
    return () => {
      active = false;
    };
  }, [api, chapterSync?.ask, setNotice]);
  const [startup, setStartup] = useState<StartupState>('connecting');
  const [startupError, setStartupError] = useState('');
  const [startupDetails, setStartupDetails] = useState<string>();
  const [diagnosticId, setDiagnosticId] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove>();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The engine panel: one panel for the app, opened from the header's
  // engine chip and from every pointer to the retired Tracks page.
  // The engine chip's state: the project's recording engine, REAPER by default.
  const engine = useRecordingEngine();
  const [enginePanelOpen, setEnginePanelOpen] = useState(false);
  const openEnginePanel = useCallback(() => setEnginePanelOpen(true), []);
  // A link inside the panel ("Open workspace" in Chapter links) moves to another page: the panel closes behind it. The one move
  // that keeps it open is the retired /tracks route's own redirect to Proof, which opened it (RetiredTracksRoute).
  const enginePanelPathRef = useRef(location.pathname);
  useEffect(() => {
    const previous = enginePanelPathRef.current;
    enginePanelPathRef.current = location.pathname;
    if (previous !== location.pathname && previous !== '/tracks') setEnginePanelOpen(false);
  }, [location.pathname]);
  const settingsActions = useRef<{ save: () => Promise<void>; discard: () => Promise<void> } | undefined>(undefined);
  const hasBootstrap = data !== undefined;

  // Importing changes data that is deliberately held at the application
  // boundary (the active manuscript affects several pages).  Refresh this
  // payload in place instead of reloading the browser, which could interrupt
  // the completion dialog before its activity log is visible.
  // The header's running-timer chip: read once for the project's manuscript,
  // so the chip shows on whichever page the app opens on, and then from every overview the Production home reads, since only its
  // Start and Stop timer change it.
  const [runningTimer, setRunningTimer] = useState<RunningTimer | null>(null);
  const onProductionOverview = useCallback((overview: ProductionOverview) => setRunningTimer(runningTimerOf(overview)), []);
  const manuscriptId = data?.manuscript?.id;
  useEffect(() => {
    if (!manuscriptId) {
      setRunningTimer(null);
      return;
    }
    let active = true;
    api
      .productionOverview()
      .then((overview) => active && setRunningTimer(runningTimerOf(overview)))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, manuscriptId]);
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

  // The DAW's reachability and its open project are a live heartbeat, but bootstrap is a snapshot taken at startup: the navigation's pill,
  // Settings' DAW Integration and the engine panel read it, so it is read again whenever the DAW starts or stops answering and when the
  // window is focused again. One picture of the DAW for every panel, never one panel saying "reachable" while another says "not reachable".
  const bootstrapRef = useRef(data);
  bootstrapRef.current = data;
  useEffect(() => {
    let lastRead = 0;
    const again = () => {
      lastRead = Date.now();
      void refreshBootstrap();
    };
    const unsubscribe = api.subscribeDawCapabilities((caps) => {
      const held = bootstrapRef.current;
      if (held && caps.daw === 'REAPER' && caps.reachable !== held.dawReachable) again();
    });
    const onFocus = () => {
      if (bootstrapRef.current && Date.now() - lastRead > DAW_FACTS_FOCUS_MS) again();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [api, refreshBootstrap]);

  // The one shared "link a REAPER project file" action behind the engine panel and Settings' DAW
  // category. Cancelling the dialog does nothing. Any .rpp links, in the project folder or elsewhere (the host's note says
  // where a file outside the folder is); only a file that is not an .rpp or is gone is refused, with its message. One
  // `usePendingAction` ref guards all three call sites at once, since the host's file dialog is native
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
        setNotice(result.note ? `REAPER project linked. ${result.note}` : 'REAPER project linked.');
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
        // the client has already written it to the host log, so it is not reported a second time.
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

  // The host tells the narrator what it did on their behalf, such as keeping a file it could not read.
  useEffect(() => {
    if (!hasBootstrap) return;
    return api.subscribeNotices(setNotice);
  }, [api, hasBootstrap, setNotice]);

  // A host job that ends is announced from here, so leaving the page that started it loses nothing. The same
  // event decides whether it is also worth an OS notification (only while the window is unfocused): document.hasFocus() is read fresh for each job,
  // here, because it is the webview's to know, not the host's.
  // No sound or toast interrupts a take: a toast that would fire while the
  // booth is recording queues here instead - `queuedAnnouncements` - and is shown once `boothRecording` clears
  // (below). The OS notification above is untouched; it only ever fires while the window is unfocused anyway.
  const navCounts = useNavCounts(location.pathname, hasManuscript);
  const boothRecording = useBoothRecording(location.pathname === '/booth');
  const boothRecordingRef = useRef(boothRecording);
  boothRecordingRef.current = boothRecording;
  const queuedAnnouncements = useRef<{ text: string; tone: ToastTone }[]>([]);
  useEffect(() => {
    if (!hasBootstrap) return;
    return api.subscribeJobEnded((event) => {
      const announcement = toastForJobEnd(event);
      if (announcement) {
        if (shouldQueueJobEndAnnouncement(announcement, boothRecordingRef.current)) queuedAnnouncements.current.push(announcement);
        else setNotice(announcement.text, announcement.tone);
      }
      if (shouldNotifyForJobEnd(event, document.hasFocus())) {
        const { title, body } = notificationForJobEnd(event);
        void api.systemNotify(event.kind, title, body);
      }
    });
  }, [api, hasBootstrap, setNotice]);
  useEffect(() => {
    if (boothRecording || queuedAnnouncements.current.length === 0) return;
    const queued = queuedAnnouncements.current;
    queuedAnnouncements.current = [];
    for (const announcement of queued) setNotice(announcement.text, announcement.tone);
  }, [boothRecording, setNotice]);

  // A check the app makes on its own found a release newer than this build: the narrator is told once, and Settings > About
  // and updates says the rest. Nothing is downloaded until they ask.
  useEffect(() => {
    if (!hasBootstrap) return;
    return api.subscribeUpdate((status) => {
      if (status.available) setNotice(`Version ${status.available.version} is available. See Settings, About & updates.`);
    });
  }, [api, hasBootstrap, setNotice]);

  // Live events that do not match their schema are dropped and counted; after a run of them the page on screen may be
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
      // Entries from the project that was open before this switch stay behind the new floor: they
      // would open this project's pages with the previous project's data, so Back stops here.
      if (state.attached) {
        history.resetFloor();
        void refreshBootstrap();
      } else if (state.reason) setNotice(state.reason, 'error');
    });
  }, [api, hasBootstrap, history, refreshBootstrap, setNotice]);

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

  // The mouse's back and forward buttons: `mousedown` also calls `preventDefault` to stop WebView2 acting on the press
  // itself (unverified on Windows), `mouseup` is where the app actually moves, like a browser's own button-4/5
  // handling. Nothing fires while a modal dialog or drawer is open (the page is inert behind it).
  useEffect(() => {
    const onMouseButton = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.type !== 'mouseup' || isModalOpen()) return;
      if (event.button === 3) guardedBackRef.current();
      else guardedForwardRef.current();
    };
    document.addEventListener('mousedown', onMouseButton);
    document.addEventListener('mouseup', onMouseButton);
    return () => {
      document.removeEventListener('mousedown', onMouseButton);
      document.removeEventListener('mouseup', onMouseButton);
    };
  }, []);

  // Alt+Left/Right, the keyboard's Browser Back/Forward keys and Cmd+[ / Cmd+] on macOS are `nav.back` and
  // `nav.forward`, `global` commands in the registry. The registry applies the target guard and resolves
  // scopes on its own; `isModalOpen()` above covers the open dialog (see its comment).
  useCommand('nav.back', () => {
    if (!isModalOpen()) guardedBackRef.current();
  });
  useCommand('nav.forward', () => {
    if (!isModalOpen()) guardedForwardRef.current();
  });
  // The header's zoom group: Ctrl+=/-/0 (and the numpad
  // equivalents) run the same steps as the header's own buttons, and do nothing while a modal is open, like Back/Forward.
  useCommand('zoom.in', () => {
    if (!isModalOpen()) void zoom.zoomIn();
  });
  useCommand('zoom.out', () => {
    if (!isModalOpen()) void zoom.zoomOut();
  });
  useCommand('zoom.reset', () => {
    if (!isModalOpen()) void zoom.reset();
  });
  // The "?" shortcut sheet: a `global` command mounted here, alongside
  // Back/Forward, since both are always-available app-level commands rather than a feature's own.
  useCommand('help.shortcuts', () => setShortcutsOpen(true));

  // The jump menu, the history panel and "Go to <page>" / "Go to <chapter>". The chapters are the store's `chapters` slot:
  // loaded when a manuscript arrives or the project changes, stale on `job:ended`, and a failed read keeps the last list ("a failure never
  // replaces a cached value"), where the local state emptied it.
  const studio = useStoreHandle();
  const projectFolder = data?.projectFolder;
  useEffect(() => {
    if (hasManuscript) void studio.load('chapters').catch(() => {});
  }, [studio, hasManuscript, projectFolder]);
  const slotChapters = useStudio((state) => state.slots.chapters);
  const chapters = hasManuscript ? (slotChapters ?? NO_CHAPTERS) : NO_CHAPTERS;
  const guardedNavigateRef = useRef<(next: string) => void>(() => {});
  const goToScriptRef = useRef<(chapter: string) => void>(() => {});
  useGoToCommands({
    pages: shellPages({ hasManuscript, dawFileLinked: data?.dawFileLinked ?? false }),
    chapters,
    go: (target) => (target.kind === 'page' ? guardedNavigateRef.current(target.id) : goToScriptRef.current(target.id)),
  });
  const dawName = () => (dawKind ? dawShortName(dawKind) : 'the DAW');
  const openHistory = () => void openHistoryPanel(overlay, journal, dawName);
  const undoLast = async () => {
    const [newest] = await journal.entries();
    const result = await journal.undoLast();
    overlay.toast(result.ok ? `Undid ${newest?.label ?? 'the last change'}` : result.refusal.reason);
  };
  // What the jump menu's catalogue rows run: the same actions as the keys and the header's buttons. A page's own command stays its own.
  const shellCommands = useRef<Record<string, () => void>>({});
  shellCommands.current = {
    'nav.back': () => guardedBackRef.current(),
    'nav.forward': () => guardedForwardRef.current(),
    'zoom.in': () => void zoom.zoomIn(),
    'zoom.out': () => void zoom.zoomOut(),
    'zoom.reset': () => void zoom.reset(),
    'help.shortcuts': () => setShortcutsOpen(true),
    'history.open': openHistory,
    'undo.last': () => void undoLast(),
    'companion.open': () => guardedNavigateRef.current('/companion'),
  };
  const openJump = (initialTerm?: string) => void openJumpMenu({ keymap, runCommand: (id) => shellCommands.current[id]?.(), initialTerm, service: overlay });
  useCommand('jump.open', () => {
    if (!isModalOpen()) openJump();
  });
  useCommand('history.open', () => {
    if (!isModalOpen()) openHistory();
  });
  useCommand('undo.last', () => {
    if (!isModalOpen()) void undoLast();
  });
  // The menu on empty space in <main> (the mock's page menu): where to go, the jump menu, view. Zoom steps are the header's own.
  const contextMenu = {
    fallback: (): ContextMenuItem[] => [
      { key: 'go-to', label: 'Go to…', onSelect: () => openJump('Go to ') },
      { key: 'zoom-in', label: 'Zoom in', unavailable: zoom.canZoomIn ? undefined : 'Already at the largest size', onSelect: () => void zoom.zoomIn() },
      { key: 'zoom-out', label: 'Zoom out', unavailable: zoom.canZoomOut ? undefined : 'Already at the smallest size', onSelect: () => void zoom.zoomOut() },
      { key: 'zoom-reset', label: 'Reset zoom', unavailable: zoom.percent === 100 ? 'Already 100%' : undefined, onSelect: () => void zoom.reset() },
      { key: 'theme', label: theme.resolved === 'dark' ? 'Use the light theme' : 'Use the dark theme', onSelect: toggleTheme },
    ],
    tail: [
      { key: 'jump', label: 'Jump menu…', onSelect: () => openJump() },
      { key: 'find', label: 'Find a page, chapter or command', onSelect: () => openJump() },
    ] satisfies ContextMenuItem[],
  };

  popGuard.dirty = settingsDirty;
  popGuard.pathname = location.pathname;
  popGuard.isOwnPop = history.isOwnPop;
  useEffect(() => {
    popGuard.ask = (direction) => setPendingMove({ kind: 'delta', direction });
    popGuard.idx = historyIdx();
    return () => {
      popGuard.ask = null;
      popGuard.dirty = false;
    };
  }, []);
  useEffect(() => {
    popGuard.idx = historyIdx();
  }, [location.key]);

  // Recovery for a `popstate` the app did not start (a mouse-button gesture WebView2 acts on
  // despite `preventDefault`, if that happens). The move already took effect; if it left
  // Settings dirty, push Settings back and ask, so the change is not lost silently. Leaving a Proof chapter view with
  // a run still resets the run either way.
  useEffect(() => {
    if (history.unexpectedPop) {
      const leftPathname = leftPathnameRef.current;
      history.clearUnexpectedPop();
      if (leftPathname === '/settings' && settingsDirty) {
        const landedAt = location.pathname + location.hash;
        navigate('/settings');
        setPendingMove({ kind: 'path', path: landedAt });
      } else if (leavesCompareRun(leftPathname, location.pathname, transcriptPhaseRef.current)) {
        void api.transcriptReset().catch(() => {});
      }
    }
    if (prevPathnameRef.current !== location.pathname) leftPathnameRef.current = prevPathnameRef.current;
    prevPathnameRef.current = location.pathname;
  }, [location.pathname, location.hash, history, settingsDirty, api, navigate]);

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
  transcriptPhaseRef.current = data.transcript.phase;

  // Deep links are expressed as a URL anchor on the fixed page path, not as
  // path params - "#p123" points at paragraph 123 (its globally unique
  // index, assigned when the manuscript is imported), "#c<chapter-id>" at a
  // chapter with no specific line, and "#<entityId>" at a Story Bible entry.
  // See components/script/page/ScriptPage.tsx and Guide.tsx for where these are consumed. The pages that call it still name the prop
  // `goToManuscript` (it opens the manuscript's text on the Script page).
  const goToScript = (chapter: string, paragraph?: number) => guardedNavigate(scriptPath(chapter, paragraph));
  const goToStoryBible = (entityId: string) => guardedNavigate(addressPath({ page: 'story-bible', entity: entityId }));
  // The Editing page at a chapter: from Proof's takes at a spot, the Production board's recording check and Proof's chapter view. findingId is the
  // deep link's ?finding=, so the page opens with the flagged word that finding names selected (Navigation and deep links); passageId is
  // ?passage=, which opens that passage's takes under its line.
  const goToEditing = (chapterId: string, findingId?: string, passageId?: string) =>
    guardedNavigate(addressPath({ page: 'editing', chapter: chapterId, finding: findingId, passage: passageId }));
  // A Manuscript card's "Record in Booth": the Booth on that chapter or credits.
  const goToBooth = (target: BoothTarget) => guardedNavigate(addressPath({ page: 'booth', target }));
  // A hand-off address that cannot be acted on says so with a way out (`AddressGate`). The chapter list it checks a named chapter
  // against is the store's slot, re-read once before an address is called stale; with no manuscript, or before the first read, the page decides.
  const gateChapters = hasManuscript ? (slotChapters ?? null) : null;
  const reloadChapters = () => studio.load('chapters');
  const gated = (page: AddressPage, element: ReactElement, chapterParam?: string) => (
    <AddressGate page={page} chapterParam={chapterParam} chapters={gateChapters} reloadChapters={reloadChapters}>
      {element}
    </AddressGate>
  );

  // A page may stop a move and ask first (the Booth does while a take is recording): the journal's leave guard answers, the overlay asks,
  // and only Yes goes on to the move's own guards below. A guard that answers 'allow', or none, leaves navigation as it was.
  const guardedNavigate = (next: string) => {
    const nextPath = next.split(/[?#]/)[0] || '/';
    const verdict = nextPath === location.pathname ? 'allow' : journal.checkLeave(nextPath);
    if (verdict === 'allow') {
      moveTo(next);
      return;
    }
    void overlay.confirm(verdict.ask).then((confirmed) => {
      if (confirmed) moveTo(next);
    });
  };
  guardedNavigateRef.current = guardedNavigate;
  goToScriptRef.current = (chapter) => goToScript(chapter);

  const moveTo = (next: string) => {
    const nextPath = next.split(/[?#]/)[0] || '/';
    if (nextPath !== location.pathname && location.pathname === '/settings' && settingsDirty) {
      setPendingMove({ kind: 'path', path: next });
      return;
    }
    if (leavesCompareRun(location.pathname, nextPath.split('?')[0], data.transcript.phase)) void api.transcriptReset().catch(() => {});
    navigate(next);
  };

  // Back and Forward run the same two guards as the nav: dirty Settings asks first, leaving
  // a Proof chapter view with a run resets the run. Each moves exactly one page, and does nothing where `useAppHistory` already
  // says there is nowhere to go (the buttons are disabled there too; this covers the shortcuts and mouse
  // buttons, which have no disabled state to rely on).
  const attemptDelta = (direction: 1 | -1) => {
    // The page's leave guard is asked first, as for the nav (the Booth while a take records). Its guard does not read the destination.
    const verdict = journal.checkLeave('');
    if (verdict !== 'allow') {
      void overlay.confirm(verdict.ask).then((confirmed) => {
        if (confirmed) moveByDelta(direction);
      });
      return;
    }
    moveByDelta(direction);
  };
  const moveByDelta = (direction: 1 | -1) => {
    if (location.pathname === '/settings' && settingsDirty) {
      setPendingMove({ kind: 'delta', direction });
      return;
    }
    if (leavesCompareRun(location.pathname, undefined, data.transcript.phase)) void api.transcriptReset().catch(() => {});
    if (direction === -1) history.back();
    else history.forward();
  };
  const guardedBack = () => {
    if (history.canGoBack) attemptDelta(-1);
  };
  const guardedForward = () => {
    if (history.canGoForward) attemptDelta(1);
  };
  guardedBackRef.current = guardedBack;
  guardedForwardRef.current = guardedForward;

  return (
    <div className="relative h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      <EnginePanelProvider value={openEnginePanel}>
        <TooltipProvider>
          <AppShell
            pathname={location.pathname}
            navigate={guardedNavigate}
            projectName={data.projectName}
            hasManuscript={Boolean(data.manuscript)}
            dawFileLinked={data.dawFileLinked}
            dawReachable={data.dawReachable}
            dawProjectMatches={data.dawProjectMatches}
            onOpenEnginePanel={openEnginePanel}
            linkingDawFile={dawLink.isBusy}
            engine={engine}
            daw={dawKind}
            timer={runningTimer}
            navCounts={navCounts}
            onOpenJump={() => openJump()}
            onOpenHistory={openHistory}
            undo={{ disabledReason: journalRows && journalRows.length > 0 ? undefined : 'Nothing to undo', run: () => void undoLast() }}
            theme={{ dark: theme.resolved === 'dark', toggle: toggleTheme }}
            contextMenu={contextMenu}
            history={{ canGoBack: history.canGoBack, canGoForward: history.canGoForward, back: guardedBack, forward: guardedForward }}
            zoom={{
              percent: zoom.percent,
              canZoomOut: zoom.canZoomOut,
              canZoomIn: zoom.canZoomIn,
              zoomIn: zoom.zoomIn,
              zoomOut: zoom.zoomOut,
              reset: zoom.reset,
              announcement: zoom.announcement,
            }}
          >
            <ErrorBoundary key={location.pathname.split('/')[1] || 'production'}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <ProductionPage
                      data={data}
                      go={guardedNavigate}
                      notify={setNotice}
                      goToScript={goToScript}
                      goToEditing={goToEditing}
                      goToBooth={(chapterId) => {
                        const credits = chapterId ? creditsKindOfId(chapterId) : undefined;
                        if (credits) goToBooth({ credits });
                        else if (chapterId) goToBooth({ chapter: chapterId });
                        else guardedNavigate('/booth');
                      }}
                      refreshBootstrap={refreshBootstrap}
                      onOverview={onProductionOverview}
                      onManuscriptChanged={() => studio.publish(MANUSCRIPT_CHANGED)}
                    />
                  }
                />
                {/* The Schedule (the Studio Next mock's Schedule page): with no manuscript it says to import one first. */}
                <Route path="/schedule" element={<SchedulePage journal={journal} hasManuscript={hasManuscript} onImport={() => guardedNavigate('/')} />} />
                <Route
                  path="/script"
                  element={
                    data.manuscript ? (
                      gated('script', <ScriptPage notify={setNotice} focusStoryBibleEntity={goToStoryBible} goToEditing={goToEditing} goToBooth={goToBooth} />)
                    ) : (
                      <NeedManuscript title="Script" onImport={() => guardedNavigate('/')} />
                    )
                  }
                />
                <Route path="/manuscript" element={<RedirectKeepingLocation to="/script" />} />
                <Route
                  path="/story-bible"
                  element={gated(
                    'story-bible',
                    <Guide notify={setNotice} goToManuscript={goToScript} hasManuscript={Boolean(data.manuscript)} onImport={() => guardedNavigate('/')} />,
                  )}
                />
                {/* Retired by the engine panel: lands on Proof, where a chapter
                  is heard, with the panel open over it, since the Tracks page's REAPER tools live there. */}
                <Route path="/tracks" element={<RetiredTracksRoute />} />
                <Route
                  path="/proof/:chapterId"
                  element={
                    data.manuscript ? (
                      <ProofChapterPage
                        notify={setNotice}
                        transcript={data.transcript}
                        dawFileLinked={data.dawFileLinked}
                        goToManuscript={goToScript}
                        goToEditing={goToEditing}
                        refreshKey={`${data.manuscript.id}:${data.manuscript.importedAt}`}
                      />
                    ) : (
                      <NeedManuscript title="Proof" onImport={() => guardedNavigate('/')} />
                    )
                  }
                />
                {/* Editing (the Studio Next mock's Editing page): the chapter's script is the editor. `/editing` opens the first chapter;
                  with no manuscript the page asks for one. */}
                <Route
                  path="/editing"
                  element={gated('editing', <EditingRoute hasManuscript={Boolean(data.manuscript)} onImport={() => guardedNavigate('/')} />)}
                />
                <Route
                  path="/editing/:chapterId"
                  element={
                    <EditingGate gated={gated}>
                      <EditingRoute hasManuscript={Boolean(data.manuscript)} onImport={() => guardedNavigate('/')} />
                    </EditingGate>
                  }
                />
                <Route
                  path="/booth"
                  element={gated(
                    'booth',
                    <BoothNextPage hasManuscript={Boolean(data.manuscript)} navigate={guardedNavigate} onImport={() => guardedNavigate('/')} />,
                  )}
                />
                <Route
                  path="/companion"
                  element={
                    data.manuscript ? (
                      <CompanionPage onFixCredits={() => guardedNavigate(addressPath({ page: 'settings', anchor: 'credits' }))} />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route path="/teleprompter" element={<RedirectKeepingLocation to="/booth" />} />
                <Route
                  path="/proof"
                  element={gated(
                    'proof',
                    <ProofPage
                      hasManuscript={Boolean(data.manuscript)}
                      projectFolder={data.projectFolder}
                      goTo={guardedNavigate}
                      goToScript={(chapterId) => goToScript(chapterId)}
                      goToBooth={(chapterId) => goToBooth({ chapter: chapterId })}
                      goToEditing={goToEditing}
                    />,
                  )}
                />
                {/* Pickups replaces the Tracks page's Pickups dialog, which had no route. */}
                <Route
                  path="/pickups"
                  element={<PickupsPage hasManuscript={Boolean(data.manuscript)} goTo={guardedNavigate} goToScript={(chapterId) => goToScript(chapterId)} />}
                />
                {/* Retired by Proof: old links land, query and hash kept. */}
                <Route path="/review" element={<RedirectKeepingLocation to="/proof" />} />
                <Route path="/proofing" element={<RedirectKeepingLocation to="/proof" />} />
                {/* A chapter's old Tracks address lands on Editing at that chapter, ?t= and ?finding= kept. */}
                <Route
                  path="/tracks/chapter/:chapterId"
                  element={<RedirectKeepingLocation to={({ chapterId = '' }) => `/editing/${encodeURIComponent(chapterId)}`} />}
                />
                {/* The Production page moved to `/`. */}
                <Route path="/production" element={<RedirectKeepingLocation to="/" />} />
                {/* Master & QC and Delivery are two pages; without a manuscript Delivery asks for one itself. */}
                <Route
                  path="/master"
                  element={gated(
                    'master',
                    <MasterPage
                      hasManuscript={Boolean(data.manuscript)}
                      projectFolder={data.projectFolder}
                      onImport={() => guardedNavigate('/')}
                      onOpenDelivery={() => guardedNavigate('/delivery')}
                      openSettings={() => guardedNavigate(addressPath({ page: 'settings', anchor: 'cleanup' }))}
                      focusFile={parseMasterHash(location.hash)?.file}
                    />,
                  )}
                />
                {/* An older finding link (`/delivery#file=…`, masterLink.ts) still lands on Master & QC, anchor kept. */}
                <Route
                  path="/delivery"
                  element={
                    parseMasterHash(location.hash) ? (
                      <RedirectKeepingLocation to="/master" />
                    ) : (
                      <DeliveryPage
                        hasManuscript={Boolean(data.manuscript)}
                        onOpenInMaster={(chapterId) => guardedNavigate(addressPath({ page: 'master', file: chapterId }))}
                        onOpenMaster={() => guardedNavigate(addressPagePath('master'))}
                        onImport={() => guardedNavigate('/')}
                      />
                    )
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <SettingsPage
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
                      go={guardedNavigate}
                      refreshBootstrap={refreshBootstrap}
                      initialCategory={SETTINGS_ANCHORS[location.hash]}
                    />
                  }
                />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </ErrorBoundary>
            <ToastRegion messages={messages} dismiss={dismissMessage} />
            <EnginePanel
              open={enginePanelOpen}
              onClose={() => setEnginePanelOpen(false)}
              notify={setNotice}
              link={{
                dawFileLinked: data.dawFileLinked,
                dawReachable: data.dawReachable,
                dawProjectMatches: data.dawProjectMatches,
                onLinkDawFile: () => void linkDawFile(),
                linkingDawFile: dawLink.isBusy,
              }}
            />
            {chapterSync?.ask && (
              <ChapterSyncConsentDialog
                projectFile={chapterSync.projectFile}
                preview={syncPreview}
                busy={syncBusy}
                onSync={() => {
                  setSyncBusy(true);
                  void api
                    .chapterSyncSetEnabled(true)
                    .catch((error) => setNotice(describeApiError(error), 'error'))
                    .finally(() => setSyncBusy(false));
                }}
                onNotNow={() => void api.chapterSyncSetEnabled(false).catch((error) => setNotice(describeApiError(error), 'error'))}
              />
            )}
          </AppShell>
        </TooltipProvider>
      </EnginePanelProvider>
      {pendingMove && (
        <ConfirmDialog
          title="Unsaved settings"
          body="Save or discard changes before leaving Settings?"
          confirmLabel="Save & continue"
          confirm={() =>
            void settingsActions.current?.save().then(() => {
              setSettingsDirty(false);
              resolvePendingMove(pendingMove);
              setPendingMove(undefined);
            })
          }
          dangerLabel="Discard & continue"
          danger={() =>
            void settingsActions.current?.discard().then(() => {
              setSettingsDirty(false);
              resolvePendingMove(pendingMove);
              setPendingMove(undefined);
            })
          }
          cancel={() => setPendingMove(undefined)}
        />
      )}
      {shortcutsOpen && (
        <ShortcutSheet
          onClose={() => setShortcutsOpen(false)}
          onShowAll={() => {
            setShortcutsOpen(false);
            guardedNavigate('/settings');
          }}
        />
      )}
    </div>
  );

  function resolvePendingMove(move: PendingMove) {
    if (move.kind === 'path') navigate(move.path);
    else if (move.direction === -1) history.back();
    else history.forward();
  }
}

/**
 * The Editing page's route: the chapter from the address, and `?finding=`, `?t=`, `?passage=` and `?drawer=` from its query (the deep links
 * other pages open it with). Stepping to another chapter replaces the address, so Back leaves Editing rather than walking its chapters.
 */
const DRAWER_TABS: readonly string[] = ['cleanup', 'effects', 'backups', 'timeline'] satisfies DrawerTab[];

/** The Editing route's chapter, read from the address for the gate that checks it. */
function EditingGate({
  gated,
  children,
}: {
  gated: (page: AddressPage, element: ReactElement, chapterParam?: string) => ReactElement;
  children: ReactElement;
}) {
  const { chapterId } = useParams<{ chapterId: string }>();
  return gated('editing', children, chapterId);
}

function EditingRoute({ hasManuscript, onImport }: { hasManuscript: boolean; onImport: () => void }) {
  const { chapterId } = useParams<{ chapterId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const t = params.get('t');
  const seconds = t === null ? undefined : Number(t);
  const drawer = params.get('drawer');
  return (
    <EditingPage
      hasManuscript={hasManuscript}
      chapterId={chapterId}
      findingId={params.get('finding') ?? undefined}
      passageId={params.get('passage') ?? undefined}
      drawer={DRAWER_TABS.includes(drawer as DrawerTab) ? (drawer as DrawerTab) : undefined}
      t={seconds !== undefined && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined}
      onChapter={(id) => navigate(`/editing/${encodeURIComponent(id)}`, { replace: true })}
      onImport={onImport}
      onGoToParagraph={(chapter, index) => navigate(scriptPath(chapter, index))}
    />
  );
}
