import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookmark as faBookmarkSolid, faChevronDown, faChevronUp, faExpand, faMicrophone, faWaveSquare } from '@fortawesome/free-solid-svg-icons';
import { faBookmark as faBookmarkRegular } from '@fortawesome/free-regular-svg-icons';
import { useId, type ReactNode } from 'react';
import { readTimeLabel } from '../../state';
import { Button } from '../primitives/Button';
import { TitleSubtitle } from '../primitives/TitleSubtitle';
import { TooltipTarget } from '../primitives/Tooltip';

// The stat block's minimum width (manuscript-chapter-header-alignment.prd.md, Q2 A): fits "99,999 words" at the mono
// font/size the word count uses, so the two lines' right edges line up down the page without a page-wide subgrid. A
// count wider than that (Q2's accepted risk) grows just that row's block instead of overflowing.
const STAT_BLOCK_CLASS = 'min-w-[6.5rem] tabular-nums';
// The action slot (manuscript-chapter-header-alignment.prd.md, Q1 A / Technical Approach): a fixed-width box rendered
// on every row, empty when the chapter has no actions, so the stat block still lines up beside it. Its content is
// right-aligned (not left-aligned), so both edges - the cluster's start and end - stay put whether or not a Retail
// sample tag widens the cluster to its left. Widened from its original 8rem (booth-mode-and-companion-panel.prd.md
// Phase 1, Open Question 1 A) to fit "Booth" beside "Read aloud" without either wrapping, and again
// (edit-and-proof-workspace.prd.md Phase 4) for the icon-only Workspace entry beside both.
const ACTION_SLOT_CLASS = 'flex w-64 flex-none justify-end gap-1';

// A Manuscript card's frame: a chapter card or a credits card (manuscript-credits-card-parity.prd.md, Phase 1),
// sharing one header and one whole-header disclosure. The header's right side is one fixed order - [Retail sample
// tag] [stat block] [action slot] [chevron] - so the stats and the action line up from row to row
// (manuscript-chapter-header-alignment.prd.md, Q6 a).
//
// Whole-header toggle without nesting controls (ADR: a control inside a button is not valid HTML, see
// primitives/Disclosure.tsx): the title button's `::after` pseudo-element is stretched over the whole header
// (`after:absolute after:inset-0`), so a press anywhere in the header - the padding, the stat block, the chevron -
// toggles the card, while the header's own `sticky` positioning gives that overlay its containing block. The
// bookmark and Read aloud sit `relative z-[1]` above the overlay so they keep their own presses and focus. The
// header keeps one tab stop for the toggle, and its accessible name stays the title (eyebrow is aria-hidden), so an
// exact-name lookup ("Opening credits", "Chapter 2 — The Pool of Tears") keeps working.
export function ReaderCard({
  chapterId,
  creditsKind,
  eyebrow,
  title,
  subtitle,
  expanded,
  onToggleExpand,
  bookmarked,
  onToggleBookmark,
  showRetailSample = false,
  showReadAloud = false,
  onReadAloud,
  showBooth = false,
  onBooth,
  showWorkspace = false,
  onWorkspace,
  wordCount,
  children,
}: {
  /** Set for a chapter card: `data-chapter`/`data-chapter-id`, which showChapter scrolls to by id. */
  chapterId?: string;
  /** Set for a credits card in place of chapterId: `data-credits-entry`, matching CreditsEntry's own tests and drivers. */
  creditsKind?: 'opening' | 'closing';
  /** The "CREDITS" eyebrow above a credits card's title, aria-hidden so the toggle's accessible name stays the title alone. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Omitted for credits (MC1): the leading column renders empty rather than a bookmark, so titles still line up. */
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
  showRetailSample?: boolean;
  showReadAloud?: boolean;
  onReadAloud?: () => void;
  /** The chapter-header "Booth" entry point (booth-mode-and-companion-panel.prd.md Phase 1, Open Question 1 A): gated
   * the same as `showReadAloud` on every caller (a narration chapter, or a credits card with something to read) - the
   * fixed-width action slot below assumes the two always agree, so a row with one and not the other misaligns it
   * from every other row in the column (manuscript-chapter-header-alignment.prd.md). */
  showBooth?: boolean;
  onBooth?: () => void;
  /** The chapter-header "Open workspace" entry point (edit-and-proof-workspace.prd.md Phase 4, page inventory
   * "Manuscript"): icon-only (a text label would overflow the fixed-width action slot beside Read aloud and Booth),
   * gated the same way on every caller - a narration chapter, never a credits card. */
  showWorkspace?: boolean;
  onWorkspace?: () => void;
  wordCount: number;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <article
      className="relative mx-[var(--reader-inline)] mb-4 scroll-mt-[var(--band-h,4rem)] overflow-visible rounded-lg border border-[var(--border)] bg-[var(--surface)]"
      data-chapter={chapterId ? title : undefined}
      data-chapter-id={chapterId}
      data-credits-entry={creditsKind}
      aria-label={creditsKind ? title : undefined}
    >
      <header
        className={`sticky top-[var(--band-h,4rem)] z-10 grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-3 border-[var(--border)] bg-[var(--surface)] p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-[var(--accent)] md:grid-cols-[1.4rem_minmax(0,1fr)_auto] md:px-5 md:py-[0.8rem] ${expanded ? 'rounded-t-lg border-b shadow-[0_2px_6px_color-mix(in_srgb,var(--text)_8%,transparent)]' : 'rounded-lg border-b-0'}`}
      >
        {onToggleBookmark ? (
          <TooltipTarget className="relative z-[1] -ml-1 flex size-[1.4rem]" text={bookmarked ? 'Remove chapter bookmark' : 'Bookmark this chapter'}>
            <button
              className={`group relative flex size-[1.4rem] items-center justify-center ${bookmarked ? 'text-[var(--bookmark)]' : 'text-[var(--non-text)]'}`}
              aria-label={bookmarked ? 'Remove chapter bookmark' : 'Bookmark this chapter'}
              onClick={onToggleBookmark}
            >
              <FontAwesomeIcon
                className={`absolute inset-0 m-auto size-[1.4rem] transition-opacity ${bookmarked ? 'opacity-0' : 'group-hover:opacity-0 group-focus-visible:opacity-0'}`}
                icon={faBookmarkRegular}
              />
              <FontAwesomeIcon
                className={`absolute inset-0 m-auto size-[1.4rem] transition-opacity ${bookmarked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
                icon={faBookmarkSolid}
              />
            </button>
          </TooltipTarget>
        ) : (
          // MC1: credits have no bookmark, but the leading grid cell still has to exist - an *absent* React child
          // (rather than an empty one) is not a grid item at all, so CSS grid auto-placement shifts the toggle button
          // and the stat cluster left by one column and the stat block's own column collapses to 0, breaking the
          // very alignment this component exists to give every card.
          <div aria-hidden="true" />
        )}
        <button
          type="button"
          // No `relative` here on purpose: this button stays position:static so its `::after` escapes to the
          // header's own sticky positioning context and stretches over the whole header, not just this button's box.
          className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggleExpand}
        >
          {eyebrow && (
            <div
              aria-hidden="true"
              className="font-['Barlow_Condensed',sans-serif] text-[0.68rem] font-semibold tracking-[0.08em] uppercase"
              style={{ color: 'var(--text-muted)' }}
            >
              {eyebrow}
            </div>
          )}
          <h2 className="m-0 font-['Barlow_Condensed',sans-serif] text-[1.2rem] font-semibold">
            <TitleSubtitle title={title} subtitle={subtitle} />
          </h2>
        </button>
        <div className="flex items-center gap-3 justify-self-end text-right max-md:col-start-2 max-md:justify-self-start">
          {showRetailSample && (
            <span className="rounded-[0.2rem] px-1.5 py-0.5 text-xs font-medium" style={{ background: 'var(--place-soft)', color: 'var(--info-text)' }}>
              Retail sample
            </span>
          )}
          <div className={STAT_BLOCK_CLASS}>
            <div className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs">{wordCount.toLocaleString()} words</div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              {readTimeLabel(wordCount)}
            </div>
          </div>
          <div className={ACTION_SLOT_CLASS}>
            {showReadAloud && (
              <TooltipTarget className="relative z-[1]" text="Read this chapter aloud and follow along">
                <Button variant="ghost" className="text-xs" aria-label={`Read ${title} aloud`} onClick={onReadAloud}>
                  <FontAwesomeIcon icon={faMicrophone} /> Read aloud
                </Button>
              </TooltipTarget>
            )}
            {showBooth && (
              <TooltipTarget className="relative z-[1]" text="Open the full-screen booth for this chapter">
                <Button variant="ghost" className="text-xs" aria-label={`Open booth for ${title}`} onClick={onBooth}>
                  <FontAwesomeIcon icon={faExpand} /> Booth
                </Button>
              </TooltipTarget>
            )}
            {showWorkspace ? (
              <TooltipTarget className="relative z-[1]" text="Open the chapter workspace: listen, follow the script and see flags">
                <Button variant="ghost" className="text-xs" aria-label={`Open workspace for ${title}`} onClick={onWorkspace}>
                  <FontAwesomeIcon icon={faWaveSquare} />
                </Button>
              </TooltipTarget>
            ) : (
              showReadAloud && (
                // A credits card has Read aloud/Booth but no chapter to open a workspace for (showWorkspace is only
                // ever set for a real chapter, manuscript-chapter-header-alignment.prd.md's caller-agreement rule
                // doesn't cover this third button): an invisible same-size placeholder keeps every Read-aloud row's
                // button cluster the same width, so Read aloud still left-aligns down the column instead of sitting
                // one button-width further right on a credits card than on a chapter.
                <Button variant="ghost" className="invisible text-xs" aria-hidden="true" tabIndex={-1}>
                  <FontAwesomeIcon icon={faWaveSquare} />
                </Button>
              )
            )}
          </div>
          <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} className="flex-none" style={{ color: 'var(--text-muted)' }} />
        </div>
      </header>
      {expanded && (
        <div id={bodyId} className="manuscript-reader mx-auto overflow-hidden rounded-b-lg">
          {children}
        </div>
      )}
    </article>
  );
}
