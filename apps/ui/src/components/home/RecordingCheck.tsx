import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { chapterName, context } from '../../chapterName';
import { useApi } from '../../api/ApiContext';
import { describeApiError } from '../../api/errorMessage';
import { useAssetInstall } from '../../hooks/useAssetInstall';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { CoverageReason, CoverageResult, CoverageStartResult, CoverageState, ManuscriptChapter, Track, WhisperInstallJob, WorkJob } from '../../types';
import { AssetFacts } from '../assets/AssetFacts';
import { AssetInstallPrompt } from '../assets/AssetInstallPrompt';
import { MappingConfirm } from '../mapping/MappingConfirm';
import { Button } from '../primitives/Button';
import { SlideOver } from '../primitives/SlideOver';
import type { Notify } from '../primitives/Toast';
import { WorkDialog } from '../primitives/WorkDialog';
import { RecordingCheckReport } from './RecordingCheckReport';
import { COVERAGE_REASON_TEXT, LINK_REASONS, REASON_PAGE, formatWhen } from './recordingCheckText';

type Refusal = Extract<CoverageStartResult, { status: 'refused' }>;
type ModelRequired = Extract<CoverageStartResult, { status: 'asset_required' }>;

const WORK_PHASE: Record<CoverageState['phase'], WorkJob['phase']> = {
  idle: 'preparing',
  running: 'running',
  complete: 'success',
  cancelled: 'cancelled',
  failed: 'error',
};

/** A check's live state as the shared work dialog shows it: the host's own percent and messages (ADR 0015), and the seconds since it started. */
function coverageWorkJob(state: CoverageState, logs: string[], now: number): WorkJob {
  const started = state.startedAt ? Date.parse(state.startedAt) : NaN;
  const ended = state.completedAt ? Date.parse(state.completedAt) : now;
  return {
    id: state.runId ?? null,
    kind: 'recording_coverage',
    phase: WORK_PHASE[state.phase],
    message: state.message,
    percent: state.percent,
    logs,
    elapsed: Number.isNaN(started) ? 0 : Math.max(0, (ended - started) / 1000),
    error: state.phase === 'failed' ? state.message : undefined,
  };
}

/**
 * One chapter's recording check (docs/utilities/recording-coverage.md, ADR 0130): the stored result (current, stale or never, with
 * its reasons and the saved-project basis), the check itself on demand (never on its own, Q14) with real progress and Cancel in the shared
 * work dialog, the Whisper model's first-use question when it is not installed (the download is never silent), and the chapter-track link
 * right in the panel when the check needs one.
 *
 * A slide-over, opened from the row's check-status cell (daw-chapter-track-auto-sync.prd.md Phase 6, S14; recording-check-summary.prd.md
 * Phase 4, RS7, D26): retiring the row's own Check button left the summary needing a new home, and a slide-over leaves the table visible
 * beside it, the same choice chapter-track-link-control.prd.md made for the track panel.
 *
 * `coverage` is the live state the Home panel follows, so a check that was left running in the background is picked up again here.
 * Mounted conditionally by the caller, same as the dialog it replaces (`{checking && <RecordingCheck .../>}`): a
 * reopened chapter is a fresh mount, so a run left going in the background, or a refusal from the last time it was
 * open, is never shown stale.
 */
export function RecordingCheck({
  chapter,
  coverage,
  notify,
  close,
  goToParagraph,
}: {
  chapter: ManuscriptChapter;
  coverage: CoverageState;
  notify: Notify;
  close: () => void;
  goToParagraph: (index: number) => void;
}) {
  const api = useApi();
  const [result, setResult] = useState<CoverageResult>();
  const [loadError, setLoadError] = useState('');
  const [refusal, setRefusal] = useState<Refusal>();
  const [modelRequired, setModelRequired] = useState<ModelRequired>();
  // The run this dialog shows progress for: one it started, or the chapter's own run already going when it opened.
  const [watching, setWatching] = useState(coverage.phase === 'running' && coverage.chapterId === chapter.id ? coverage.runId : undefined);
  // The state the start answered with, until the first live event of that run arrives.
  const [startedState, setStartedState] = useState<CoverageState>();
  const [logs, setLogs] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const actions = usePendingAction();

  const load = useCallback(async () => {
    try {
      setLoadError('');
      setResult(await api.coverageResult(chapter.id));
    } catch (error) {
      setLoadError(describeApiError(error));
    }
  }, [api, chapter.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = watching && coverage.runId === watching ? coverage : watching && startedState?.runId === watching ? startedState : undefined;

  // The activity log is the host's distinct messages for the run, in order.
  useEffect(() => {
    if (!live?.message) return;
    setLogs((current) => (current[current.length - 1] === live.message ? current : [...current, live.message]));
  }, [live?.message]);

  useEffect(() => {
    if (live?.phase !== 'running') return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [live?.phase]);

  // A finished check replaces the progress with its result at once; the app's job:ended toast says it too (ADR 0076).
  useEffect(() => {
    if (live?.phase !== 'complete') return;
    setWatching(undefined);
    void load();
  }, [live?.phase, load]);

  const whisperInstall = useAssetInstall<WhisperInstallJob>({
    start: () => (modelRequired ? api.whisperInstall(modelRequired.model.id) : Promise.reject(new Error('Check a recording first.'))),
    state: (jobId) => api.whisperInstallState(jobId),
    cancel: (jobId) => api.whisperInstallCancel(jobId),
    onSuccess: async () => {
      setModelRequired(undefined);
      notify('Whisper model installed.');
      await start();
    },
  });

  const start = () =>
    actions.run('check', async () => {
      setRefusal(undefined);
      try {
        const answer = await api.coverageStart(chapter.id);
        if (answer.status === 'refused') setRefusal(answer);
        else if (answer.status === 'asset_required') {
          whisperInstall.reset();
          setModelRequired(answer);
        } else {
          setLogs([]);
          setStartedState(answer.state);
          setWatching(answer.state.runId);
        }
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  const cancel = () =>
    void actions.run('cancel', async () => {
      try {
        await api.coverageCancel();
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  if (modelRequired) {
    return (
      <AssetInstallPrompt
        ask={{
          title: 'Download local Whisper model?',
          body: `The ${modelRequired.model.displayName} Whisper model is needed to transcribe this chapter's recording. It is not bundled with Narration Utils and will be stored in your per-user asset cache.`,
          confirmLabel: 'Download model',
        }}
        workTitle="Downloading Whisper model"
        install={whisperInstall}
        dismiss={() => {
          setModelRequired(undefined);
          whisperInstall.reset();
        }}
      >
        <AssetFacts
          label="Model"
          name={modelRequired.model.displayName}
          version={modelRequired.model.version}
          publisher={modelRequired.model.publisher}
          license={modelRequired.model.license}
          licenseUrl={modelRequired.model.licenseUrl}
          modelCardUrl={modelRequired.model.modelCardUrl}
          provenanceUrl={modelRequired.model.provenanceUrl}
          downloadSize={modelRequired.downloadSize}
          diskSize={modelRequired.diskSize}
          installPath={modelRequired.installPath}
        />
      </AssetInstallPrompt>
    );
  }

  if (live) {
    return (
      <WorkDialog
        title={`Checking ${chapterName(chapter, 'short')}`}
        job={coverageWorkJob(live, logs, now)}
        cancel={cancel}
        // The check ends with a job:ended event the app announces wherever the narrator is (ADR 0076), and the Home row keeps its percent.
        background={close}
        close={() => {
          setWatching(undefined);
          void load();
        }}
      />
    );
  }

  const otherRunning = coverage.phase === 'running' && coverage.chapterId !== chapter.id;
  const checked = result?.state === 'current' || result?.state === 'stale';
  const checkButton = (
    <Button onClick={() => void start()} pending={actions.isPending('check')} disabled={otherRunning}>
      {checked ? 'Check again' : 'Check recording'}
    </Button>
  );
  return (
    <SlideOver open title={chapterName(chapter, context('Recording check'))} onClose={close}>
      <div className="space-y-4 text-sm">
        {refusal && (
          <ReasonBlock
            tone="alert"
            title="The recording could not be checked"
            reasons={[refusal.reason]}
            detail={refusal.message}
            chapter={chapter}
            onLinked={async () => {
              setRefusal(undefined);
              await load();
            }}
          />
        )}
        {otherRunning && (
          <p role="status" style={{ color: 'var(--text-muted)' }}>
            Another chapter is being checked. Check this one when it finishes.
          </p>
        )}
        <ResultBody
          chapter={chapter}
          result={result}
          loadError={loadError}
          retry={load}
          goToParagraph={goToParagraph}
          showReasons={!refusal}
          checkButton={checkButton}
        />
      </div>
    </SlideOver>
  );
}

function ResultBody({
  chapter,
  result,
  loadError,
  retry,
  goToParagraph,
  showReasons,
  checkButton,
}: {
  chapter: ManuscriptChapter;
  result?: CoverageResult;
  loadError: string;
  retry: () => Promise<void>;
  goToParagraph: (index: number) => void;
  showReasons: boolean;
  /** Check recording / Check again (recording-check-summary.prd.md Phase 4): the slide-over has no dialog action bar,
   * so it sits with the report's own figures when there is a report, and right here otherwise. */
  checkButton: ReactNode;
}) {
  if (loadError) {
    return (
      <div role="alert" className="space-y-2">
        <p style={{ color: 'var(--danger-text)' }}>The last check could not be read: {loadError}</p>
        <Button variant="ghost" onClick={() => void retry()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!result) return <p role="status">Reading the last check…</p>;
  return (
    <>
      {result.basis && (
        <p style={{ color: 'var(--text-muted)' }}>
          Based on the saved REAPER project, file modified {formatWhen(result.basis.modifiedAt)}.
          {result.basis.stale && ' The saved file is older than the recorded audio: save the project in REAPER, then check again.'}
        </p>
      )}
      {result.state === 'never' && (
        <>
          <p>
            Not checked yet. A check transcribes this chapter&rsquo;s audio from the saved project and compares it with the text, so you can see what is still
            to record. It changes nothing in the project.
          </p>
          {showReasons && result.reasons.length > 0 && (
            <ReasonBlock tone="note" title="Before checking" reasons={result.reasons} chapter={chapter} onLinked={retry} />
          )}
          {checkButton}
        </>
      )}
      {result.state === 'stale' && (
        <ReasonBlock
          tone="note"
          title="This result is out of date"
          reasons={result.reasons}
          chapter={chapter}
          onLinked={retry}
          footer={result.record ? `Checked ${formatWhen(result.record.completedAt)}. The counts below are from then; check again to update them.` : undefined}
        />
      )}
      {result.state === 'current' && result.record && (
        <p style={{ color: 'var(--text-muted)' }}>
          Checked {formatWhen(result.record.completedAt)}
          {result.result ? ` with the ${result.result.model} Whisper model` : ''}.
        </p>
      )}
      {result.result && (
        <RecordingCheckReport chapter={chapter} report={result.result} judgement={result.judgement} goToParagraph={goToParagraph} actionsSlot={checkButton} />
      )}
    </>
  );
}

/** Why a check was refused or a result cannot be trusted, in plain words, with the way to fix it where there is one. */
function ReasonBlock({
  tone,
  title,
  reasons,
  detail,
  footer,
  chapter,
  onLinked,
}: {
  tone: 'alert' | 'note';
  title: string;
  reasons: CoverageReason[];
  /** The host's own sentence, which can name a file or an item; shown small under the plain one. */
  detail?: string;
  footer?: string;
  chapter: ManuscriptChapter;
  onLinked: () => Promise<void>;
}) {
  const unique = [...new Set(reasons)];
  const link = unique.some((reason) => LINK_REASONS.has(reason));
  const pages = [...new Map(unique.flatMap((reason) => (REASON_PAGE[reason] ? [[REASON_PAGE[reason]!.path, REASON_PAGE[reason]!]] : []))).values()];
  return (
    <div
      role={tone === 'alert' ? 'alert' : undefined}
      className="space-y-2 rounded-md border px-3 py-2"
      style={{ borderColor: tone === 'alert' ? 'var(--danger)' : 'var(--border)', background: 'var(--surface-2)' }}
    >
      <p className="font-semibold" style={tone === 'alert' ? { color: 'var(--danger-text)' } : undefined}>
        {title}
      </p>
      <ul className="list-disc space-y-1 pl-5">
        {unique.map((reason) => (
          <li key={reason}>{COVERAGE_REASON_TEXT[reason] ?? reason}</li>
        ))}
      </ul>
      {detail && (
        <p className="text-xs break-words" style={{ color: 'var(--text-muted)' }}>
          Details: {detail}
        </p>
      )}
      {footer && <p style={{ color: 'var(--text-muted)' }}>{footer}</p>}
      {link && <TrackLink chapter={chapter} onLinked={onLinked} />}
      {pages.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pages.map((page) => (
            <Link key={page.path} to={page.path} className="text-sm font-semibold underline">
              {page.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** The chapter-track link, confirmed right here (analysis evidence ledger PRD, Phase 7): the same prompt the Tracks page lists. */
function TrackLink({ chapter, onLinked }: { chapter: ManuscriptChapter; onLinked: () => Promise<void> }) {
  const api = useApi();
  const [tracks, setTracks] = useState<Track[]>();
  const [error, setError] = useState('');
  const confirming = usePendingAction();
  useEffect(() => {
    let active = true;
    api
      .tracksList()
      .then((project) => active && setTracks(project.tracks))
      .catch((reason) => active && setError(describeApiError(reason)));
    return () => {
      active = false;
    };
  }, [api]);
  if (error)
    return (
      <p style={{ color: 'var(--danger-text)' }}>
        The REAPER tracks could not be listed: {error}{' '}
        <Link to="/tracks" className="font-semibold underline">
          Open Tracks
        </Link>
      </p>
    );
  if (!tracks) return <p role="status">Reading the REAPER tracks…</p>;
  return (
    <MappingConfirm
      chapterTitle={chapter.title}
      tracks={tracks}
      busy={confirming.isBusy}
      onConfirm={(trackGuid) =>
        void confirming.run('confirm', async () => {
          try {
            await api.chapterTrackMapConfirm(trackGuid, chapter.id);
            setError('');
            await onLinked();
          } catch (reason) {
            setError(describeApiError(reason));
          }
        })
      }
      onClear={() => {}}
    />
  );
}
