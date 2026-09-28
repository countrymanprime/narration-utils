import { useCallback, useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faCopy, faFileLines, faMinus, faPlus, faThumbtack, faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { ManuscriptChapter, PinnedPreview, PreviewCandidate, PreviewResult } from '../../types';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { describeParagraphs, formatAudioTime, paragraphRefs } from '../home/recordingCheckText';
import { Panel } from '../primitives/Panel';
import { IconButton } from '../primitives/IconButton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { TooltipTarget } from '../primitives/Tooltip';
import type { Notify } from '../primitives/Toast';

type Phase = 'loading' | 'ready' | 'error';

/**
 * The Proofing page's preview suggestion (proofing-preview-suggestion.prd.md Phase 3): up to three candidate
 * five-minute excerpts, computed fresh on every read (SR D1 - nothing here is applied, exported or stored; opening a
 * candidate in the reader or copying its range starts nothing either).
 */
export function PreviewPanel({ notify, goToManuscript }: { notify: Notify; goToManuscript: (chapter: string, paragraph: number) => void }) {
  const api = useApi();
  const [phase, setPhase] = useState<Phase>('loading');
  const [result, setResult] = useState<PreviewResult>();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [error, setError] = useState('');
  const [copiedChapterId, setCopiedChapterId] = useState<string>();
  const [pinned, setPinned] = useState<PinnedPreview>();
  const [pinBusy, setPinBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setPhase('loading');
    Promise.all([api.previewCandidates(), api.manuscriptChapters(), api.previewPin()])
      .then(([preview, loadedChapters, pin]) => {
        if (!active) return;
        setResult(preview);
        setChapters(loadedChapters);
        setPinned(pin);
        setPhase('ready');
      })
      .catch((err) => {
        if (!active) return;
        setError(describeApiError(err));
        setPhase('error');
      });
    return () => {
      active = false;
    };
  }, [api]);

  // Every pin action (User Flow step 5) re-reads the pin the binding itself just resolved, rather than guessing the
  // new state locally: the host recomputes evidence and staleness fresh on every call (SR D1), so this is the one
  // source of truth after a set, adjust or clear.
  const runPinAction = useCallback(
    (action: () => Promise<PinnedPreview>) => {
      setPinBusy(true);
      action()
        .then(setPinned)
        .catch((err: unknown) => notify(describeApiError(err), 'error'))
        .finally(() => setPinBusy(false));
    },
    [notify],
  );

  const pinCandidate = (candidate: PreviewCandidate) => runPinAction(() => api.previewPinSet(candidate.chapterId, candidate.paragraphIds));
  const clearPin = () => runPinAction(() => api.previewPinClear());
  const adjustPin = (edge: 'start' | 'end', grow: boolean) => runPinAction(() => api.previewPinAdjust(edge, grow));

  const isPinned = (candidate: PreviewCandidate): boolean =>
    pinned?.present === true &&
    pinned.candidate?.chapterId === candidate.chapterId &&
    pinned.candidate.paragraphIds.length === candidate.paragraphIds.length &&
    pinned.candidate.paragraphIds.every((id, index) => id === candidate.paragraphIds[index]);

  // The "Copied" confirmation reverts itself after a couple of seconds (ScriptView.tsx's own flash-then-clear
  // pattern), a fresh timer per copy so two quick copies of different candidates each get their own window.
  useEffect(() => {
    if (!copiedChapterId) return;
    const clear = window.setTimeout(() => setCopiedChapterId(undefined), 2000);
    return () => window.clearTimeout(clear);
  }, [copiedChapterId]);

  const paragraphNumbers = (candidate: PreviewCandidate): number[] => {
    const chapter = chapters.find((item) => item.id === candidate.chapterId);
    return chapter ? paragraphRefs(chapter, candidate.paragraphIds).map((ref) => ref.number) : [];
  };

  const firstParagraphIndex = (candidate: PreviewCandidate): number | undefined => {
    const chapter = chapters.find((item) => item.id === candidate.chapterId);
    if (!chapter || candidate.paragraphIds.length === 0) return undefined;
    return paragraphRefs(chapter, candidate.paragraphIds.slice(0, 1))[0]?.index;
  };

  const copyRange = (candidate: PreviewCandidate) => {
    const text = `${candidate.chapterTitle}, ${describeParagraphs(paragraphNumbers(candidate))} (${formatAudioTime(candidate.estimatedSeconds)})`;
    void navigator.clipboard?.writeText(text).then(
      () => setCopiedChapterId(candidate.chapterId),
      (err) => notify(describeApiError(err), 'error'),
    );
  };

  return (
    <Panel title="Preview">
      {phase === 'loading' && (
        <p role="status" className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Computing suggestions…
        </p>
      )}
      {phase === 'error' && (
        <p role="alert" className="mt-1 text-sm" style={{ color: 'var(--danger-text)' }}>
          Couldn’t read preview suggestions: {error}
        </p>
      )}
      {phase === 'ready' && result?.outcome === 'no_manuscript' && (
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Import a manuscript to see preview suggestions.
        </p>
      )}
      {phase === 'ready' && result?.outcome === 'nothing_eligible' && (
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          No eligible text was found for a preview. Narration chapters with at least one paragraph are needed.
        </p>
      )}
      {phase === 'ready' && result?.outcome === 'ok' && (
        <div className="mt-1 overflow-auto">
          <Table label="Preview candidates">
            <TableHead>
              <TableRow>
                <TableHeader>Chapter</TableHeader>
                <TableHeader>Paragraphs</TableHeader>
                <TableHeader align="right">Length</TableHeader>
                <TableHeader align="right">Words</TableHeader>
                <TableHeader>Why suggested</TableHeader>
                <TableHeader hiddenLabel="Actions" />
              </TableRow>
            </TableHead>
            <TableBody>
              {result.candidates.map((candidate) => {
                const copied = copiedChapterId === candidate.chapterId;
                const isThisPinned = isPinned(candidate);
                return (
                  <TableRow key={candidate.chapterId}>
                    <TableCell className="font-medium">{candidate.chapterTitle}</TableCell>
                    <TableCell className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs whitespace-nowrap">
                      {describeParagraphs(paragraphNumbers(candidate))}
                    </TableCell>
                    <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs whitespace-nowrap">
                      {formatAudioTime(candidate.estimatedSeconds)}
                    </TableCell>
                    <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs">
                      {candidate.wordCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">
                      <ul className="space-y-0.5">
                        {candidate.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                      {candidate.warnings.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {candidate.warnings.map((warning) => (
                            <li key={warning} className="flex items-start gap-1" style={{ color: 'var(--warn-text)' }}>
                              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" className="mt-0.5 flex-none" />
                              <span>{warning}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <TooltipTarget text={`Open ${candidate.chapterTitle} in the manuscript reader`}>
                          <IconButton
                            label={`Open ${candidate.chapterTitle} in the manuscript reader`}
                            onClick={() => goToManuscript(candidate.chapterId, firstParagraphIndex(candidate) ?? 0)}
                          >
                            <FontAwesomeIcon icon={faFileLines} />
                          </IconButton>
                        </TooltipTarget>
                        <TooltipTarget text={copied ? 'Copied' : `Copy range and length for ${candidate.chapterTitle}`}>
                          <IconButton label={copied ? 'Copied' : `Copy range and length for ${candidate.chapterTitle}`} onClick={() => copyRange(candidate)}>
                            <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
                          </IconButton>
                        </TooltipTarget>
                        <TooltipTarget text={isThisPinned ? `Unpin ${candidate.chapterTitle}` : `Pin ${candidate.chapterTitle} as the preview to keep`}>
                          <IconButton
                            label={isThisPinned ? `Unpin ${candidate.chapterTitle}` : `Pin ${candidate.chapterTitle} as the preview to keep`}
                            variant={isThisPinned ? 'primary' : 'default'}
                            disabledReason={pinBusy ? 'A pin action is already in progress.' : undefined}
                            onClick={() => (isThisPinned ? clearPin() : pinCandidate(candidate))}
                          >
                            <FontAwesomeIcon icon={faThumbtack} />
                          </IconButton>
                        </TooltipTarget>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {pinned?.present && (
        <div className="mt-3 rounded-md border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Pinned preview</h3>
            <TooltipTarget text="Clear the pinned preview">
              <IconButton label="Clear the pinned preview" disabledReason={pinBusy ? 'A pin action is already in progress.' : undefined} onClick={clearPin}>
                <FontAwesomeIcon icon={faXmark} />
              </IconButton>
            </TooltipTarget>
          </div>
          {pinned.stale && (
            <p role="status" className="mt-1 flex items-start gap-1 text-sm" style={{ color: 'var(--warn-text)' }}>
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" className="mt-0.5 flex-none" />
              <span>
                {pinned.staleReason === 'paragraph_missing'
                  ? 'This pinned range is no longer in the manuscript (a re-import likely changed the paragraphs). Clear it and pin a new one.'
                  : 'The manuscript text under this pin has changed since it was pinned or last adjusted.'}
              </span>
            </p>
          )}
          {pinned.candidate && (
            <>
              <p className="mt-1 text-sm">
                {pinned.candidate.chapterTitle}, {describeParagraphs(paragraphNumbers(pinned.candidate))} ({formatAudioTime(pinned.candidate.estimatedSeconds)})
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {pinned.candidate.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
                {pinned.candidate.warnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-1" style={{ color: 'var(--warn-text)' }}>
                    <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" className="mt-0.5 flex-none" />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  Start:
                  <TooltipTarget text="Extend the start by one paragraph">
                    <IconButton
                      label="Extend the start by one paragraph"
                      disabledReason={
                        !pinned.canExtendStart ? 'Already at the start of the chapter.' : pinBusy ? 'A pin action is already in progress.' : undefined
                      }
                      onClick={() => adjustPin('start', true)}
                    >
                      <FontAwesomeIcon icon={faPlus} />
                    </IconButton>
                  </TooltipTarget>
                  <TooltipTarget text="Shrink the start by one paragraph">
                    <IconButton
                      label="Shrink the start by one paragraph"
                      disabledReason={
                        !pinned.canShrinkStart ? 'This range is already one paragraph.' : pinBusy ? 'A pin action is already in progress.' : undefined
                      }
                      onClick={() => adjustPin('start', false)}
                    >
                      <FontAwesomeIcon icon={faMinus} />
                    </IconButton>
                  </TooltipTarget>
                </span>
                <span className="flex items-center gap-1">
                  End:
                  <TooltipTarget text="Extend the end by one paragraph">
                    <IconButton
                      label="Extend the end by one paragraph"
                      disabledReason={
                        !pinned.canExtendEnd ? 'Already at the end of the chapter.' : pinBusy ? 'A pin action is already in progress.' : undefined
                      }
                      onClick={() => adjustPin('end', true)}
                    >
                      <FontAwesomeIcon icon={faPlus} />
                    </IconButton>
                  </TooltipTarget>
                  <TooltipTarget text="Shrink the end by one paragraph">
                    <IconButton
                      label="Shrink the end by one paragraph"
                      disabledReason={
                        !pinned.canShrinkEnd ? 'This range is already one paragraph.' : pinBusy ? 'A pin action is already in progress.' : undefined
                      }
                      onClick={() => adjustPin('end', false)}
                    >
                      <FontAwesomeIcon icon={faMinus} />
                    </IconButton>
                  </TooltipTarget>
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
