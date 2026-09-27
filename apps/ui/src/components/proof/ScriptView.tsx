import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceExtra, WorkspaceParagraph, WorkspaceToken } from '../../api/contracts/workspace';
import { Button } from '../primitives/Button';

const STATUS_CLASS: Partial<Record<WorkspaceToken['status'], string>> = {
  skip: 'line-through',
  head: 'italic',
  tail: 'italic',
  short_read: 'underline decoration-dashed',
  different_text: 'underline decoration-dashed',
  misread: 'underline decoration-wavy',
};

function tokenColor(status: WorkspaceToken['status']): string | undefined {
  switch (status) {
    case 'skip':
    case 'head':
    case 'tail':
      return 'var(--text-muted)';
    case 'short_read':
    case 'different_text':
    case 'misread':
      return 'var(--warn-text)';
    default:
      return undefined;
  }
}

function Token({ token, isCurrent, onSeek }: { token: WorkspaceToken; isCurrent: boolean; onSeek: (token: WorkspaceToken) => void }) {
  const clickable = token.start !== undefined;
  const className = `${STATUS_CLASS[token.status] ?? ''} ${isCurrent ? 'rounded px-0.5' : ''} ${clickable ? 'cursor-pointer hover:underline' : ''}`.trim();
  const style = { color: tokenColor(token.status), backgroundColor: isCurrent ? 'var(--accent-soft, var(--surface-2))' : undefined, font: 'inherit' };
  const content = (
    <>
      {token.text}
      {token.status === 'misread' && token.heard && (
        <sup className="ml-0.5 text-[0.65em]" style={{ color: 'var(--text-muted)' }}>
          heard &ldquo;{token.heard}&rdquo;
        </sup>
      )}
    </>
  );
  if (!clickable) {
    return (
      <span data-token-index={token.i} className={className} style={style}>
        {content}
      </span>
    );
  }
  return (
    <button type="button" data-token-index={token.i} className={`${className} inline bg-transparent p-0`} style={style} onClick={() => onSeek(token)}>
      {content}
    </button>
  );
}

function ExtraChip({ extra }: { extra: WorkspaceExtra }) {
  return (
    <span
      className="mx-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      {'↻'} repeat &middot; &ldquo;{extra.text}&rdquo;
    </span>
  );
}

/**
 * The chapter's script, one paragraph at a time (edit-and-proof-workspace.prd.md Phase 2): every token rendered
 * inline, flagged ones marked in place (struck through, underlined, dimmed - see STATUS_CLASS), the currently
 * playing token highlighted, and a click on a timed token seeking the app player there (EP5). Auto-scrolls the
 * current token into view while playing, and stops (scroll-lock) the moment the narrator scrolls the panel
 * themselves, with a "Resume following" control to re-engage - the mockup's "Following playback - scroll away to
 * stop following" status line. Paragraphs get `content-visibility: auto` so the browser skips laying out and
 * painting the (thousands of) words currently off-screen, a chapter's worth of virtualisation with no extra code.
 */
export function ScriptView({
  paragraphs,
  tokens,
  extras,
  currentTokenIndex,
  isPlaying,
  onSeekToken,
}: {
  paragraphs: WorkspaceParagraph[];
  tokens: WorkspaceToken[];
  extras: WorkspaceExtra[];
  currentTokenIndex: number | undefined;
  isPlaying: boolean;
  onSeekToken: (token: WorkspaceToken) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const suppressScrollRef = useRef(false);
  const [autoFollow, setAutoFollow] = useState(true);

  const tokensByParagraph = useMemo(() => {
    const map = new Map<string, WorkspaceToken[]>();
    tokens.forEach((token) => {
      if (token.p === undefined) return;
      const list = map.get(token.p);
      if (list) list.push(token);
      else map.set(token.p, [token]);
    });
    return map;
  }, [tokens]);

  const extrasAfterToken = useMemo(() => {
    const map = new Map<number, WorkspaceExtra[]>();
    extras.forEach((extra) => {
      if (extra.afterToken === undefined) return;
      const list = map.get(extra.afterToken);
      if (list) list.push(extra);
      else map.set(extra.afterToken, [extra]);
    });
    return map;
  }, [extras]);

  useEffect(() => {
    if (!autoFollow || currentTokenIndex === undefined) return;
    const container = containerRef.current;
    const target = container?.querySelector(`[data-token-index="${currentTokenIndex}"]`);
    if (!container || !target) return;
    suppressScrollRef.current = true;
    target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    const clear = setTimeout(() => {
      suppressScrollRef.current = false;
    }, 400);
    return () => clearTimeout(clear);
  }, [autoFollow, currentTokenIndex]);

  const wordCount = tokens.length;

  return (
    <section aria-label="Script" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-[1.1rem] shadow-[var(--shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        <span className="section-label">
          Script &middot; {paragraphs.length} paragraphs &middot; {wordCount.toLocaleString()} words
        </span>
        <span>
          {!isPlaying ? 'Paused · click a word to play from it' : autoFollow ? 'Following playback · scroll away to stop following' : 'Not following playback'}
          {isPlaying && !autoFollow && (
            <Button
              variant="ghost"
              className="ml-2 px-2 py-0.5 text-xs"
              onClick={() => {
                setAutoFollow(true);
              }}
            >
              Resume following
            </Button>
          )}
        </span>
      </div>
      <div
        ref={containerRef}
        className="mt-3 max-h-[28rem] space-y-3 overflow-y-auto leading-relaxed"
        onScroll={() => {
          if (suppressScrollRef.current) return;
          setAutoFollow(false);
        }}
      >
        {tokens.length === 0 && paragraphs.length > 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            This chapter&rsquo;s last check predates word-by-word alignment: the text below has no highlighting, flags or click-to-seek yet. Run Check again to
            get those.
          </p>
        )}
        {paragraphs.map((paragraph) => {
          const paragraphTokens = tokensByParagraph.get(paragraph.id) ?? [];
          if (paragraphTokens.length === 0) {
            return (
              <p key={paragraph.id} id={`workspace-paragraph-${paragraph.id}`} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 3rem' }}>
                {paragraph.text}
              </p>
            );
          }
          return (
            <p key={paragraph.id} id={`workspace-paragraph-${paragraph.id}`} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 3rem' }}>
              {paragraphTokens.map((token, index) => (
                <span key={token.i}>
                  {index > 0 && ' '}
                  <Token token={token} isCurrent={token.i === currentTokenIndex} onSeek={onSeekToken} />
                  {extrasAfterToken.get(token.i)?.map((extra, extraIndex) => (
                    <ExtraChip key={extraIndex} extra={extra} />
                  ))}
                </span>
              ))}
            </p>
          );
        })}
      </div>
    </section>
  );
}
