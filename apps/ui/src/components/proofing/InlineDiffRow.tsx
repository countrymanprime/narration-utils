import type { Discrepancy } from '../../types';

export const KIND_STYLES: Record<string, { color: string; soft: string }> = {
  MISREAD: { color: 'var(--review)', soft: 'var(--review-soft)' },
  SKIPPED: { color: 'var(--warn)', soft: 'var(--accent-soft)' },
  EXTRA: { color: 'var(--info)', soft: 'var(--place-soft)' },
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

export function InlineDiffRow({ row }: { row: Discrepancy }) {
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
      <span style={{ color: 'var(--text-faint)' }}>—</span>
    );
  return (
    <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
      <td colSpan={6} className="p-3 text-sm">
        <div className="space-y-1.5">
          <div>
            <span className="text-xs tracking-wide uppercase" style={{ color: 'var(--text-faint)' }}>
              Script
            </span>
            <div className="mt-0.5">{render(diff.script)}</div>
          </div>
          <div>
            <span className="text-xs tracking-wide uppercase" style={{ color: 'var(--text-faint)' }}>
              Heard
            </span>
            <div className="mt-0.5">{render(diff.heard)}</div>
          </div>
        </div>
      </td>
    </tr>
  );
}
