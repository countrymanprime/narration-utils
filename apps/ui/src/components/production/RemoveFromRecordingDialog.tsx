import { useState } from 'react';
import type { ManuscriptContentKind } from '../../api/contracts/manuscript';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { RadioGroup } from '../primitives/RadioGroup';

const OPTIONS = [
  { value: 'reference' as const, label: 'Not a chapter', description: 'A part title, an epigraph or a false split. Hidden from navigation too.' },
  { value: 'opening' as const, label: 'Front matter', description: "Stays in the manuscript's navigation, not recorded as a chapter." },
];

/**
 * "Remove <chapter> from recording?" (chapter-track-link-control.prd.md Phase 3, mockup 06): a reclassification, not
 * a delete (D12 does not list it among the danger confirms), so the confirm button stays the ordinary primary
 * colour. `kind` defaults to `reference` ("Not a chapter"), the PRD's recommended default (TL2).
 */
export function RemoveFromRecordingDialog({
  chapterTitle,
  busy,
  onConfirm,
  onCancel,
}: {
  chapterTitle: string;
  busy: boolean;
  onConfirm: (kind: ManuscriptContentKind) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<ManuscriptContentKind>('reference');
  return (
    <ConfirmDialog
      title={`Remove ${chapterTitle} from recording?`}
      body={
        <div className="space-y-3">
          <p>
            It leaves the chapter table, totals, the reader and the teleprompter. Its text stays in the manuscript, and its track link is cleared. You can
            restore it below the table.
          </p>
          <RadioGroup label="What is it?" value={kind} onChange={setKind} options={OPTIONS} />
        </div>
      }
      confirmLabel="Remove from recording"
      confirm={() => onConfirm(kind)}
      cancel={onCancel}
      pending={busy}
    />
  );
}
