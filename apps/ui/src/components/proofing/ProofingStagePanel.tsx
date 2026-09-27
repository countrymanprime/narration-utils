import { useCallback, useEffect, useState } from 'react';
import type { ManuscriptChapter } from '../../types';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { Panel } from '../primitives/Panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { useStageRecommendations } from '../stages/useStageRecommendations';
import { useRefreshOnFocus } from '../stages/useRefreshOnFocus';
import { StageSuggestion } from '../stages/StageSuggestion';
import { StageEvidence } from '../stages/StageEvidence';
import type { Notify } from '../primitives/Toast';

const narration = (chapter: ManuscriptChapter) => chapter.contentKind === undefined || chapter.contentKind === 'narration';

/**
 * The Proofing page's own stage-recommendations surface (docs/prds/chapter-stage-recommendations.prd.md Phase 8):
 * every narration chapter currently in Proofing, with the same `StageSuggestion` row and `StageEvidence` slide-over
 * Home's breakdown table uses (Phase 5) - no new pattern. Unlike Home, this panel is chapter-based rather than tied
 * to the last Transcript Compare run's identity (the transcript state carries no chapter id), so it reads the
 * chapter list and the suggestions independently of whatever `Transcript` above it is doing.
 */
export function ProofingStagePanel({
  notify,
  goToManuscript,
  refreshKey,
}: {
  notify: Notify;
  /** Opens the manuscript at a chapter and paragraph (its index in the whole manuscript). */
  goToManuscript: (chapter: string, paragraph: number) => void;
  /** Changes after a manuscript import/replacement, like Home's own (AudiobookEstimatePanel.tsx). */
  refreshKey: string;
}) {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>();
  const [error, setError] = useState('');
  const [why, setWhy] = useState<{ chapterId: string; open: boolean }>();

  const loadChapters = useCallback(async () => {
    try {
      const loaded = await api.manuscriptChapters();
      setChapters(loaded);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, [api]);

  useEffect(() => {
    void loadChapters();
  }, [loadChapters, refreshKey]);

  const stages = useStageRecommendations({
    refreshKey,
    notify,
    onStatus: (chapterId, status) => setChapters((current) => current?.map((chapter) => (chapter.id === chapterId ? { ...chapter, status } : chapter))),
  });
  useRefreshOnFocus(() => {
    void loadChapters();
    void stages.refresh();
  }, stages.busy);

  const rows = (chapters ?? []).filter((chapter) => narration(chapter) && chapter.status === 'proofing');
  const whyChapter = why ? rows.find((chapter) => chapter.id === why.chapterId) : undefined;

  return (
    <Panel title="Proofing readiness">
      {error && (
        <p role="alert" className="mt-1 text-sm" style={{ color: 'var(--danger-text)' }}>
          Couldn’t read the chapter list: {error}
        </p>
      )}
      {!error && chapters && rows.length === 0 && (
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          No chapter is in Proofing right now.
        </p>
      )}
      {!error && rows.length > 0 && (
        <div className="mt-1 overflow-auto">
          <Table label="Chapters in proofing">
            <TableHead>
              <TableRow>
                <TableHeader>Chapter</TableHeader>
                <TableHeader>Suggestion</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((chapter) => (
                <TableRow key={chapter.id}>
                  <TableCell className="font-medium">{chapter.title}</TableCell>
                  <TableCell>
                    <StageSuggestion
                      title={chapter.title}
                      recommendation={stages.state.byChapter.get(chapter.id)}
                      phase={stages.state.phase}
                      isPending={(decision) => stages.isPending(decision, chapter.id)}
                      busy={stages.busy}
                      onDecide={(decision) => {
                        const recommendation = stages.state.byChapter.get(chapter.id);
                        if (recommendation) void stages.decide(decision, recommendation);
                      }}
                      onWhy={() => setWhy({ chapterId: chapter.id, open: true })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {why && (
        <StageEvidence
          open={why.open}
          chapter={whyChapter}
          recommendation={stages.state.byChapter.get(why.chapterId)}
          phase={stages.state.phase}
          error={stages.state.error}
          isPending={(decision) => stages.isPending(decision, why.chapterId)}
          busy={stages.busy}
          onDecide={(decision) => {
            const recommendation = stages.state.byChapter.get(why.chapterId);
            if (recommendation) void stages.decide(decision, recommendation);
          }}
          onClose={() => setWhy({ ...why, open: false })}
          onCheckNow={() => void stages.refresh()}
          // Proofing's own causes never resolve to `check` (stageText.ts's PROOFING_CAUSE_TEXT): there is no
          // per-chapter "proofing check" dialog to open, unlike recording and editing, so these are unreachable.
          onOpenCheck={() => {}}
          onOpenEditingCheck={() => {}}
          goToParagraph={(paragraph) => goToManuscript(why.chapterId, paragraph)}
        />
      )}
    </Panel>
  );
}
