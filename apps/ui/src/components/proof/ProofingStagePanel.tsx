import { useState } from 'react';
import type { ChapterStatus, ManuscriptChapter } from '../../types';
import { Panel } from '../primitives/Panel';
import { useStageRecommendations } from '../stages/useStageRecommendations';
import { useRefreshOnFocus } from '../stages/useRefreshOnFocus';
import { StageSuggestion } from '../stages/StageSuggestion';
import { StageEvidence } from '../stages/StageEvidence';
import type { Notify } from '../primitives/Toast';
import { RenderAssociationSection } from './RenderAssociationSection';

/**
 * This chapter's proofing readiness (proofing-readiness-signals.prd.md Phase 6, in the Proof chapter view per D79):
 * the pickup roll-up and delivery-check suggestion (`StageSuggestion`, the same one the Production board uses),
 * SR's evidence popover for "why", and the chapter's chosen rendered file with Choose, Clear and Measure
 * (`RenderAssociationSection`). Shown only while the chapter is in Proofing status, the same gate the pre-D79
 * Proofing page's book-wide table used - a chapter this panel confirms to Finalized simply stops showing it, since
 * SR's own confirmation and evidence-changed notice live on the Production board, not here.
 */
export function ProofingStagePanel({
  notify,
  chapter,
  goToManuscript,
  refreshKey,
  onStatusChanged,
  onOpenFinding,
}: {
  notify: Notify;
  chapter: ManuscriptChapter | undefined;
  /** Opens the manuscript at a chapter and paragraph (its index in the whole manuscript). */
  goToManuscript: (chapter: string, paragraph: number) => void;
  /** Changes after a manuscript import/replacement, like the Production board's own (ChapterBoard.tsx). */
  refreshKey: string;
  /** The chapter's status changed by Confirm or Revert, so the page's own chapter state follows. */
  onStatusChanged: (status: ChapterStatus) => void;
  /** Opens the flag an evidence entry's open pickup names, inline on this same page. */
  onOpenFinding: (findingId: string) => void;
}) {
  const [why, setWhy] = useState(false);
  const chapterId = chapter?.id;

  const stages = useStageRecommendations({
    refreshKey,
    notify,
    onStatus: (id, status) => {
      if (id === chapterId) onStatusChanged(status);
    },
  });
  useRefreshOnFocus(() => void stages.refresh(), stages.busy);

  if (!chapter || chapter.status !== 'proofing') return null;
  const recommendation = stages.state.byChapter.get(chapter.id);

  return (
    <Panel title="Proofing readiness">
      <StageSuggestion
        title={chapter.title}
        recommendation={recommendation}
        phase={stages.state.phase}
        isPending={(decision) => stages.isPending(decision, chapter.id)}
        busy={stages.busy}
        onDecide={(decision) => {
          if (recommendation) void stages.decide(decision, recommendation);
        }}
        onWhy={() => setWhy(true)}
      />
      <RenderAssociationSection chapterId={chapter.id} notify={notify} />
      {why && (
        <StageEvidence
          open={why}
          chapter={chapter}
          recommendation={recommendation}
          phase={stages.state.phase}
          error={stages.state.error}
          isPending={(decision) => stages.isPending(decision, chapter.id)}
          busy={stages.busy}
          onDecide={(decision) => {
            if (recommendation) void stages.decide(decision, recommendation);
          }}
          onClose={() => setWhy(false)}
          onCheckNow={() => void stages.refresh()}
          // Proofing's own causes never resolve to `check` (stageText.ts's PROOFING_CAUSE_TEXT and
          // PROOFING_DELIVERY_CAUSE_TEXT): there is no per-chapter "proofing check" dialog to open, unlike recording
          // and editing, so these are unreachable.
          onOpenCheck={() => {}}
          onOpenEditingCheck={() => {}}
          onOpenFinding={onOpenFinding}
          goToParagraph={(paragraph) => goToManuscript(chapter.id, paragraph)}
        />
      )}
    </Panel>
  );
}
