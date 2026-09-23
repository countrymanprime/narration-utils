import { Highlight } from '../primitives/Highlight';

// The legend for every mark the reader can show (teleprompter-manuscript-integration.prd.md, "Key and flag marks").
// Phase 2 covered the three marks that exist on the page (read, current, skipped); Phase 5 adds the story bible and note
// marks (`marks`), and the flag marks (misread, extra, skipped-as-a-review-item) are Phase 7's. The current-word and
// skipped swatches copy `ReaderText`'s own styling by hand rather than rendering a real `Highlight kind="Cursor"`/`data-word`,
// so this legend is never mistaken for the actual current word by a `[data-highlight="Cursor"]` or `[data-word]` query (the
// reader's own tests and the mock-driven visual states rely on those being unique). The story bible and note swatches are
// real `Highlight`s (ADR 0016/0017): nothing looks them up as unique.
// `layout="row"` is the inline strip above the text (the standalone page); `"list"` is the read-aloud rail's Key tab.
export function ReaderKey({ seekable, marks = false, layout = 'row' }: { seekable: boolean; marks?: boolean; layout?: 'row' | 'list' }) {
  const list = layout === 'list';
  return (
    <div
      className={list ? 'flex flex-col items-start gap-2 text-sm' : 'flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'}
      style={{ color: 'var(--text-muted)' }}
      aria-label="Key"
    >
      {!list && <span className="font-medium">Key:</span>}
      <span className="flex items-center gap-1.5">
        <span className="rounded-[0.15rem] px-[0.05em]" style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}>
          word
        </span>{' '}
        current word
      </span>
      <span className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
        word read
      </span>
      <span className="flex items-center gap-1.5">
        <span style={{ textDecoration: 'underline dotted var(--warn)', textUnderlineOffset: '0.25em' }}>word</span> skipped
      </span>
      {marks && (
        <>
          <span className="flex items-center gap-1.5">
            <Highlight kind="Character">name</Highlight> story bible entry
          </span>
          <span className="flex items-center gap-1.5">
            <Highlight kind="Note">words</Highlight> note
          </span>
        </>
      )}
      {/* Click-to-seek (teleprompter-manuscript-integration.prd.md Phase 4): only reachable once a session is
          running, so the hint only shows then - it would be misleading while idle, when no word is clickable. */}
      {seekable && <span className={list ? '' : 'ml-auto'}>Click a word to start or go back to it.</span>}
      {marks && <span>Click a highlighted name or note to open it here. The reading position stays where it is.</span>}
    </div>
  );
}
