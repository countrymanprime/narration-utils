import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { chapterName, context } from '../../chapterName';
import { useApi } from '../../api/ApiContext';
import { describeApiError } from '../../api/errorMessage';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { EditingRefusalReason, EditingState, Finding, ManuscriptChapter, StageSignal, StageSignalState, Track } from '../../types';
import { Button } from '../primitives/Button';
import { ProgressBar } from '../primitives/ProgressBar';
import { SlideOver } from '../primitives/SlideOver';
import type { Notify } from '../primitives/Toast';
import { MappingConfirm } from '../mapping/MappingConfirm';
import { useReaperStatus } from '../review/useReaperStatus';
import { formatWhen } from '../home/recordingCheckText';
import { formatAge, SIGNAL_STATE_LABEL } from '../stages/stageText';
import { EditingCandidateRow } from './EditingCandidateRow';
import { EDITING_CLASSES, EDITING_CLASS_LABEL, EDITING_SIGNAL_ID, PROCESSED_AUDIO_CAVEAT, candidateClass, sortCandidates } from './editingCheckText';

/** The host's own refusal sentences (apps/desktop/internal/editing/service.go), for a reason the mapping prompt
 * below does not already explain in place. */
const NON_MAPPING_REFUSAL: Partial<Record<EditingRefusalReason, string>> = {
  no_project: 'Open a project before checking editing.',
  no_project_file: 'Choose the saved REAPER project file on the Tracks page first.',
  project_unreadable: 'The saved REAPER project file could not be read. Save it again in REAPER.',
  busy: 'Another editing check is running. Wait for it to finish.',
};

const MAPPING_REFUSALS = new Set<EditingRefusalReason>(['unmapped', 'multiple_tracks', 'mapped_track_missing']);

const POLL_MS = 500;

/** The chapter-track link, confirmed right here (analysis evidence ledger PRD, Phase 7): the same prompt the
 * Tracks page and Home's recording check show. */
function MappingFix({ chapter, onLinked }: { chapter: ManuscriptChapter; onLinked: () => void }) {
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
            onLinked();
          } catch (reason) {
            setError(describeApiError(reason));
          }
        })
      }
      onClear={() => {}}
    />
  );
}

function stateBadgeColor(state: StageSignalState): string | undefined {
  return state === 'not_met' ? 'var(--danger-text)' : undefined;
}

/**
 * One editing class's summary (editing-readiness-analysis.prd.md Phase 6's signal, when it is available: only while
 * the chapter is in the Editing stage, apps/desktop/internal/stages engine D3): state, reason, and the saved-project
 * basis with its age. Outside the Editing stage the signal is not evaluated at all, so the summary falls back to a
 * plain candidate count from the last scan - never a state, since a state this build did not compute is not one it
 * can vouch for.
 */
function ClassSummary({
  cls,
  signal,
  candidates,
  now,
  reaperStatus,
  onReaperStatusChange,
  onCandidateChanged,
}: {
  cls: (typeof EDITING_CLASSES)[number];
  signal: StageSignal | undefined;
  candidates: Finding[];
  now: number;
  reaperStatus: ReturnType<typeof useReaperStatus>['status'];
  onReaperStatusChange: () => Promise<void>;
  onCandidateChanged: (finding: Finding) => void;
}) {
  const ordered = sortCandidates(candidates);
  return (
    <section className="space-y-2 rounded-md border border-[var(--border)] px-3 py-2">
      <p className="font-semibold">{EDITING_CLASS_LABEL[cls]}</p>
      {signal ? (
        <>
          <p>
            <span className="font-semibold" style={{ color: stateBadgeColor(signal.state) }}>
              {SIGNAL_STATE_LABEL[signal.state]}.
            </span>{' '}
            {signal.reason}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Based on the saved REAPER project, file modified {formatWhen(signal.basis.projectFileModTime)}
            {formatAge(signal.basis.projectFileModTime, now) && ` (${formatAge(signal.basis.projectFileModTime, now)})`}.
          </p>
        </>
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>
          {ordered.length > 0 ? `${ordered.length} candidate${ordered.length === 1 ? '' : 's'} from the last scan.` : 'No candidates from the last scan.'} A met
          or not-met status shows only while this chapter is in Editing.
        </p>
      )}
      {ordered.map((finding) => (
        <EditingCandidateRow
          key={finding.id}
          finding={finding}
          reaperStatus={reaperStatus}
          onReaperStatusChange={onReaperStatusChange}
          onChanged={onCandidateChanged}
        />
      ))}
    </section>
  );
}

/**
 * The editing check panel (editing-readiness-analysis.prd.md Phase 7): a `SlideOver` opened from SR's evidence
 * popover (`StageEvidence`'s "Open editing check") and from the Tracks page's chapter list. It runs the scan
 * (Phase 5's job, cache-first, with real progress and Cancel), reads the three signals Phase 6 computes when the
 * chapter is in the Editing stage, and lists every open candidate under its own class with a Hear control, Accept /
 * Dismiss / Defer through RD-4, and Go to / Loop in REAPER through RD Phase 7 when the bridge is connected. Analysis
 * never starts on its own (Q9): opening the panel only reads what is already known.
 *
 * There is no live event for the scan job (unlike the recording check's `coverage:state`, editing-readiness-analysis.prd.md
 * Phase 5's own note): the panel polls `editingState()` itself while a run for this chapter is going, so the panel
 * stays open with its previous candidates visible underneath the progress bar rather than swapping to a separate
 * dialog the way the recording check does - the narrator can keep reading the last scan's candidates while a
 * re-check of a mostly-cached chapter finishes in a second or two.
 */
export function EditingCheckPanel({ chapter, notify, close }: { chapter: ManuscriptChapter; notify: Notify; close: () => void }) {
  const api = useApi();
  const reaper = useReaperStatus();
  const action = usePendingAction();
  const [job, setJob] = useState<EditingState>();
  const [refusal, setRefusal] = useState<{ reason: EditingRefusalReason; message: string }>();
  const [signals, setSignals] = useState<StageSignal[]>();
  const [candidates, setCandidates] = useState<Finding[]>([]);
  const [candidatesError, setCandidatesError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const documentIdRef = useRef<string | undefined>(undefined);
  const prevPhaseRef = useRef<EditingState['phase'] | undefined>(undefined);

  const loadCandidates = useCallback(async () => {
    try {
      setCandidatesError('');
      setCandidates(await api.editingCandidates(chapter.id));
    } catch (error) {
      setCandidatesError(describeApiError(error));
    }
  }, [api, chapter.id]);

  const loadSignals = useCallback(async () => {
    try {
      const recommendations = await api.stageRecommendations();
      const own = recommendations.chapters.find((entry) => entry.chapterId === chapter.id);
      setSignals(own?.signals.filter((signal) => signal.id.startsWith('editing.')));
    } catch {
      // The panel still works from candidates and the job alone; a signal-read failure is not blocking.
      setSignals(undefined);
    }
  }, [api, chapter.id]);

  useEffect(() => {
    void loadCandidates();
    void loadSignals();
    void api.editingState().then(setJob);
  }, [loadCandidates, loadSignals, api]);

  const thisChapterRunning = job?.phase === 'running' && job.chapterId === chapter.id;
  const otherRunning = job?.phase === 'running' && job.chapterId !== chapter.id;

  useEffect(() => {
    if (!thisChapterRunning) return;
    let active = true;
    const timer = window.setInterval(() => {
      void api.editingState().then((next) => active && setJob(next));
    }, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, thisChapterRunning]);

  useEffect(() => {
    if (job?.chapterId !== chapter.id) return;
    if (prevPhaseRef.current === 'running' && job.phase !== 'running') {
      void loadCandidates();
      void loadSignals();
    }
    prevPhaseRef.current = job?.phase;
  }, [job, chapter.id, loadCandidates, loadSignals]);

  useEffect(() => {
    if (job?.phase !== 'running') return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [job?.phase]);

  const start = () =>
    action.run('start', async () => {
      setRefusal(undefined);
      try {
        if (!documentIdRef.current) documentIdRef.current = (await api.chapterTrackMapList()).documentId;
        const answer = await api.editingStart(documentIdRef.current, chapter.id, chapter.title);
        if (answer.status === 'refused') setRefusal({ reason: answer.reason, message: answer.message });
        else setJob(answer.state);
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  const cancel = () =>
    void action.run('cancel', async () => {
      try {
        await api.editingCancel();
        await api.editingState().then(setJob);
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  const onCandidateChanged = (finding: Finding) => setCandidates((current) => current.map((item) => (item.id === finding.id ? finding : item)));

  const mappingRefusal = refusal && MAPPING_REFUSALS.has(refusal.reason);
  const checked = job?.phase === 'complete' || job?.phase === 'cancelled' || job?.phase === 'failed';

  return (
    <SlideOver open title={chapterName(chapter, context('Editing check'))} onClose={close}>
      <div className="space-y-4 text-sm">
        <p style={{ color: 'var(--text-muted)' }}>{PROCESSED_AUDIO_CAVEAT}</p>

        {refusal && !mappingRefusal && (
          <p role="alert" style={{ color: 'var(--danger-text)' }}>
            {NON_MAPPING_REFUSAL[refusal.reason] ?? refusal.message}
          </p>
        )}
        {refusal && mappingRefusal && (
          <div className="space-y-2 rounded-md border px-3 py-2" style={{ borderColor: 'var(--danger)', background: 'var(--surface-2)' }}>
            <p className="font-semibold" style={{ color: 'var(--danger-text)' }}>
              This chapter can&rsquo;t be checked yet
            </p>
            <p>{refusal.message}</p>
            {refusal.reason === 'multiple_tracks' ? (
              <Link to="/tracks" className="font-semibold underline">
                Open Tracks
              </Link>
            ) : (
              <MappingFix
                chapter={chapter}
                onLinked={() => {
                  setRefusal(undefined);
                  void loadSignals();
                }}
              />
            )}
          </div>
        )}
        {otherRunning && (
          <p role="status" style={{ color: 'var(--text-muted)' }}>
            Another chapter is being checked. Check this one when it finishes.
          </p>
        )}

        {thisChapterRunning && job && (
          <div className="space-y-2">
            <p role="status">{job.message}</p>
            <ProgressBar label="Editing check progress" value={job.percent} running valueText={`${job.itemsDone} of ${job.itemsTotal} items`} />
            <Button variant="ghost" onClick={cancel} pending={action.isPending('cancel')}>
              Cancel
            </Button>
          </div>
        )}

        {!thisChapterRunning && (
          <Button onClick={() => void start()} pending={action.isPending('start')} disabled={otherRunning}>
            {checked ? 'Check again' : 'Check editing'}
          </Button>
        )}

        {candidatesError && (
          <p role="alert" style={{ color: 'var(--danger-text)' }}>
            The last check could not be read: {candidatesError}
          </p>
        )}

        <div className="space-y-3">
          {EDITING_CLASSES.map((cls) => (
            <ClassSummary
              key={cls}
              cls={cls}
              signal={signals?.find((signal) => signal.id === EDITING_SIGNAL_ID[cls])}
              candidates={candidates.filter((finding) => candidateClass(finding) === cls)}
              now={now}
              reaperStatus={reaper.status}
              onReaperStatusChange={reaper.refresh}
              onCandidateChanged={onCandidateChanged}
            />
          ))}
        </div>
      </div>
    </SlideOver>
  );
}
