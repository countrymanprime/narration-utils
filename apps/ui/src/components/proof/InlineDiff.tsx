import type { Discrepancy } from '../../types';

const KIND_STYLES: Record<string, { color: string; soft: string }> = {
  MISREAD: { color: 'var(--danger-text)', soft: 'var(--review-soft)' },
  SKIPPED: { color: 'var(--warn-text)', soft: 'var(--accent-soft)' },
  EXTRA: { color: 'var(--info-text)', soft: 'var(--place-soft)' },
};

function diffWords(script: string, heard: string) {
  const scriptWords = script.split(/\s+/).filter(Boolean);
  const heardWords = heard.split(/\s+/).filter(Boolean);
  const heardSet = new Set(heardWords.map((word) => word.toLowerCase()));
  const scriptSet = new Set(scriptWords.map((word) => word.toLowerCase()));
  return {
    script: scriptWords.map((word) => ({ word, mismatch: !heardSet.has(word.toLowerCase()) })),
    heard: heardWords.map((word) => ({ word, mismatch: !scriptSet.has(word.toLowerCase()) })),
  };
}

/**
 * A Transcript Compare discrepancy's script and heard text side by side, the words that differ marked in the
 * discrepancy's colour (the Proofing page's expanded results row, moved into the Proof chapter view's flag detail by
 * stage-navigation-and-page-replacement.prd.md Phase 5). Uses the wider context when the host sent it.
 */
export function InlineDiff({ row }: { row: Discrepancy }) {
  const style = KIND_STYLES[row.kind] ?? KIND_STYLES.MISREAD;
  const diff = diffWords(row.scriptContext || row.docText || '', row.audioContext || row.audioText || '');
  const render = (parts: { word: string; mismatch: boolean }[]) =>
    parts.length > 0 ? (
      parts.map((part, index) =>
        part.mismatch ? (
          <mark key={index} className="mx-0.5 rounded px-1" style={{ background: style.soft, color: style.color }}>
            {part.word}
          </mark>
        ) : (
          <span key={index}> {part.word}</span>
        ),
      )
    ) : (
      <span style={{ color: 'var(--text-muted)' }}>—</span>
    );
  return (
    <div className="space-y-1.5 rounded p-2" style={{ background: 'var(--surface-2)' }}>
      <div>
        <span className="section-label">Script</span>
        <div className="mt-0.5">{render(diff.script)}</div>
      </div>
      <div>
        <span className="section-label">Heard</span>
        <div className="mt-0.5">{render(diff.heard)}</div>
      </div>
    </div>
  );
}
