import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { FxRequest } from './ApplyFxDialog';
import type { WorkspaceExtra, WorkspaceParagraph, WorkspaceToken } from '../../api/contracts/workspace';
import { Button } from '../primitives/Button';
import { ContextMenu, type ContextMenuItem } from '../primitives/ContextMenu';
import { Panel } from '../primitives/Panel';
import { SectionLabel } from '../primitives/SectionLabel';
import { StatusBadge } from '../primitives/StatusBadge';

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

function Token({
  token,
  isCurrent,
  isSelected,
  onSeek,
  onExtend,
}: {
  token: WorkspaceToken;
  isCurrent: boolean;
  isSelected: boolean;
  onSeek: (token: WorkspaceToken) => void;
  onExtend: (token: WorkspaceToken) => void;
}) {
  const clickable = token.start !== undefined;
  const className =
    `${STATUS_CLASS[token.status] ?? ''} ${isCurrent || isSelected ? 'rounded px-0.5' : ''} ${clickable ? 'cursor-pointer hover:underline' : ''}`.trim();
  const style = {
    color: tokenColor(token.status),
    backgroundColor: isSelected ? 'var(--accent-soft)' : isCurrent ? 'var(--accent-soft, var(--surface-2))' : undefined,
    boxShadow: isSelected ? 'inset 0 -2px 0 var(--accent)' : undefined,
    font: 'inherit',
  };
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
      <span data-token-index={token.i} data-selected={isSelected || undefined} className={className} style={style}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-token-index={token.i}
      data-selected={isSelected || undefined}
      className={`${className} inline bg-transparent p-0`}
      style={style}
      onClick={(event) => (event.shiftKey ? onExtend(token) : onSeek(token))}
    >
      {content}
    </button>
  );
}

function ExtraChip({ extra }: { extra: WorkspaceExtra }) {
  return <StatusBadge tone="neutral" look="outline" className="mx-1" icon="↻" label={`repeat · “${extra.text}”`} />;
}

/**
 * The chapter's script, one paragraph at a time (edit-and-proof-workspace.prd.md Phase 2): every token rendered
 * inline, flagged ones marked in place (struck through, underlined, dimmed - see STATUS_CLASS), the currently
 * playing token highlighted, and a click on a timed token seeking the app player there (EP5). Auto-scrolls the
 * current token into view while playing, and stops (scroll-lock) the moment the narrator scrolls the panel
 * themselves, with a "Resume following" control to re-engage - the mockup's "Following playback - scroll away to
 * stop following" status line. Shift+click selects a passage from the last word clicked (a right click selects the word
 * under it), and the right-click menu offers to add an effect to the passage or put an FX chain on the chapter's track
 * (edit-and-proof-workspace.prd.md Phase 9, `effects`). Paragraphs get `content-visibility: auto` so the browser skips laying out and
 * painting the (thousands of) words currently off-screen, a chapter's worth of virtualisation with no extra code.
 */
export function ScriptView({
  paragraphs,
  tokens,
  extras,
  currentTokenIndex,
  isPlaying,
  onSeekToken,
  effects,
}: {
  paragraphs: WorkspaceParagraph[];
  tokens: WorkspaceToken[];
  extras: WorkspaceExtra[];
  currentTokenIndex: number | undefined;
  isPlaying: boolean;
  onSeekToken: (token: WorkspaceToken) => void;
  /** Effects on a passage (Phase 9): `blocked` is why REAPER cannot be asked now (not connected), or undefined; `onRequest`
   * opens the confirm step. Absent, the script offers no menu. */
  effects?: { blocked: string | undefined; onRequest: (request: FxRequest) => void };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const suppressScrollRef = useRef(false);
  const [autoFollow, setAutoFollow] = useState(true);
  // The passage the narrator selected: Shift+click from the last word clicked (the anchor), or the word a right click
  // landed on. A plain click still seeks and only moves the anchor.
  const [anchor, setAnchor] = useState<number>();
  const [range, setRange] = useState<{ first: number; last: number }>();

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
    // Only the script's own box scrolls, never the page: the chapter view leads with mock 04's notes (ADR 0470), so a
    // `scrollIntoView` here would drag the whole page down to the script on load and on every word.
    const box = container.getBoundingClientRect();
    const word = target.getBoundingClientRect();
    container.scrollBy?.({ top: word.top - box.top - (container.clientHeight - word.height) / 2, behavior: 'smooth' });
    const clear = setTimeout(() => {
      suppressScrollRef.current = false;
    }, 400);
    return () => clearTimeout(clear);
  }, [autoFollow, currentTokenIndex]);

  const wordCount = tokens.length;

  const seek = (token: WorkspaceToken) => {
    setAnchor(token.i);
    setRange(undefined);
    onSeekToken(token);
  };
  const extend = (token: WorkspaceToken) => {
    const from = anchor ?? token.i;
    setAnchor(from);
    setRange({ first: Math.min(from, token.i), last: Math.max(from, token.i) });
  };
  const openMenu = (event: MouseEvent) => {
    const hit = event.target instanceof Element ? event.target.closest('[data-token-index]') : null;
    const index = hit ? Number(hit.getAttribute('data-token-index')) : undefined;
    if (index === undefined || Number.isNaN(index)) return;
    if (range && index >= range.first && index <= range.last) return;
    setAnchor(index);
    setRange({ first: index, last: index });
  };
  const passageText = (selected: { first: number; last: number }): string => {
    const words = tokens.filter((token) => token.i >= selected.first && token.i <= selected.last).map((token) => token.text);
    return words.length > 8 ? `${words.slice(0, 8).join(' ')} …` : words.join(' ');
  };
  const menuItems: ContextMenuItem[] = effects
    ? [
        {
          key: 'plugin',
          label: 'Add an effect to this passage…',
          unavailable: range ? effects.blocked : 'Select words first: click a word, then Shift+click another.',
          onSelect: () => range && effects.onRequest({ kind: 'plugin', firstToken: range.first, lastToken: range.last, passage: passageText(range) }),
        },
        {
          key: 'chain',
          label: "Put an FX chain on the chapter's track…",
          unavailable: effects.blocked,
          onSelect: () => effects.onRequest({ kind: 'chain' }),
        },
      ]
    : [];
  const selectedCount = range ? range.last - range.first + 1 : 0;

  return (
    <Panel label="Script">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        <SectionLabel>
          Script &middot; {paragraphs.length} paragraphs &middot; {wordCount.toLocaleString()} words
        </SectionLabel>
        <span>
          {!isPlaying ? 'Paused · click a word to play from it' : autoFollow ? 'Following playback · scroll away to stop following' : 'Not following playback'}
          {isPlaying && !autoFollow && (
            <Button
              size="sm"
              variant="secondary"
              className="ml-2"
              onClick={() => {
                setAutoFollow(true);
              }}
            >
              Resume following
            </Button>
          )}
        </span>
      </div>
      {range && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" role="status">
          <span>
            {selectedCount} {selectedCount === 1 ? 'word' : 'words'} selected: <q>{passageText(range)}</q>
            {effects ? ' · right-click for effects' : ''}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setRange(undefined);
            }}
          >
            Clear selection
          </Button>
        </div>
      )}
      {/* The script scrolls on its own, so it takes focus and a name (WCAG 2.1.1, axe scrollable-region-focusable): the arrow keys
          scroll it even while its words are skipped off-screen by content-visibility and nothing inside can take focus. */}
      <ContextMenu items={menuItems} onOpen={effects ? openMenu : undefined} className="mt-3">
        <div
          ref={containerRef}
          role="region"
          aria-label="Script text"
          tabIndex={0}
          className="max-h-[28rem] space-y-3 overflow-y-auto leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          onScroll={() => {
            if (suppressScrollRef.current) return;
            setAutoFollow(false);
          }}
        >
          {tokens.length === 0 && paragraphs.length > 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              This chapter&rsquo;s last check predates word-by-word alignment: the text below has no highlighting, flags or click-to-seek yet. Run Check again
              to get those.
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
                    <Token
                      token={token}
                      isCurrent={token.i === currentTokenIndex}
                      isSelected={range !== undefined && token.i >= range.first && token.i <= range.last}
                      onSeek={seek}
                      onExtend={extend}
                    />
                    {extrasAfterToken.get(token.i)?.map((extra, extraIndex) => (
                      <ExtraChip key={extraIndex} extra={extra} />
                    ))}
                  </span>
                ))}
              </p>
            );
          })}
        </div>
      </ContextMenu>
    </Panel>
  );
}
