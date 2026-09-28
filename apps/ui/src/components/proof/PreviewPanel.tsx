import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faCopy, faFileLines, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { ManuscriptChapter, PreviewCandidate, PreviewResult } from '../../types';
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

  useEffect(() => {
    let active = true;
    setPhase('loading');
    Promise.all([api.previewCandidates(), api.manuscriptChapters()])
      .then(([preview, loadedChapters]) => {
        if (!active) return;
        setResult(preview);
        setChapters(loadedChapters);
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
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
