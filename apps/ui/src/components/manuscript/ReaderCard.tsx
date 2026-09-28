import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookmark as faBookmarkSolid, faChevronDown, faChevronUp, faMicrophone, faWaveSquare } from '@fortawesome/free-solid-svg-icons';
import { faBookmark as faBookmarkRegular } from '@fortawesome/free-regular-svg-icons';
import { useId, type ReactNode } from 'react';
import { readTimeLabel } from '../../state';
import { Button } from '../primitives/Button';
import { PANEL_FRAME_CLASS } from '../primitives/panelStyles';
import { SectionLabel } from '../primitives/SectionLabel';
import { TitleSubtitle } from '../primitives/TitleSubtitle';
import { TooltipTarget } from '../primitives/Tooltip';

// The stat block's minimum width (manuscript-chapter-header-alignment.prd.md, Q2 A): fits "99,999 words" at the mono
// font/size the word count uses, so the two lines' right edges line up down the page without a page-wide subgrid. A
// count wider than that (Q2's accepted risk) grows just that row's block instead of overflowing.
const STAT_BLOCK_CLASS = 'min-w-[6.5rem] tabular-nums';
// The action slot (manuscript-chapter-header-alignment.prd.md, Q1 A / Technical Approach): a fixed-width box rendered
// on every row, empty when the chapter has no actions, so the stat block still lines up beside it. Its content is
// right-aligned (not left-aligned), so both edges - the cluster's start and end - stay put whether or not a Retail
// sample tag widens the cluster to its left. Sized for "Record in Booth" (stage-navigation-and-page-replacement.prd.md
// Phase 4, Q9, which replaced the Read aloud, Booth and Companion buttons) and the icon-only Workspace entry beside it
// (edit-and-proof-workspace.prd.md Phase 4).
const ACTION_SLOT_CLASS = 'flex w-52 flex-none justify-end gap-1';

// A Manuscript card's frame: a chapter card or a credits card (manuscript-credits-card-parity.prd.md, Phase 1),
// sharing one header and one whole-header disclosure. The header's right side is one fixed order - [Retail sample
// tag] [stat block] [action slot] [chevron] - so the stats and the action line up from row to row
// (manuscript-chapter-header-alignment.prd.md, Q6 a).
//
// Whole-header toggle without nesting controls (ADR: a control inside a button is not valid HTML, see
// primitives/Disclosure.tsx): the title button's `::after` pseudo-element is stretched over the whole header
// (`after:absolute after:inset-0`), so a press anywhere in the header - the padding, the stat block, the chevron -
// toggles the card, while the header's own `sticky` positioning gives that overlay its containing block. The
// bookmark and Record in Booth sit `relative z-[1]` above the overlay so they keep their own presses and focus. The
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
  onRecordInBooth,
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
  /** "Record in Booth" (stage-navigation-and-page-replacement.prd.md Phase 4, Q9): the Booth page on this chapter or
   * credits. Omitted where there is nothing to read aloud (a reference chapter, empty credits); the slot stays either way. */
  onRecordInBooth?: () => void;
  /** The chapter-header "Open workspace" entry point (edit-and-proof-workspace.prd.md Phase 4, page inventory
   * "Manuscript"): icon-only, so it fits the fixed-width action slot beside Record in Booth; only ever set for a
   * narration chapter, never a credits card. */
  showWorkspace?: boolean;
  onWorkspace?: () => void;
  wordCount: number;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <article
      // `@container` (Tailwind v4's built-in container-query support, verified against the installed
      // tailwindcss@4.3.3): the header below reacts to this card's own rendered width, not the viewport - see the
      // arbitrary `@min-` container variant on the header. `container-type: inline-size` only contains sizing in
      // the inline axis and does not clip overflow (that needs `size`, not `inline-size`), so the header's sticky
      // positioning and the toggle's `overflow-visible` are unaffected.
      className={`${PANEL_FRAME_CLASS} @container relative mx-[var(--reader-inline)] mb-4 scroll-mt-[var(--band-h,4rem)] overflow-visible`}
      data-chapter={chapterId ? title : undefined}
      data-chapter-id={chapterId}
      data-credits-entry={creditsKind}
      aria-label={creditsKind ? title : undefined}
    >
      {/* The header's right-side cluster (Retail sample tag, stat block, action slot, chevron) sits beside the title
          once the card itself has room, and wraps below it otherwise (manuscript-chapter-header-alignment.prd.md).
          That used to be a viewport breakpoint (`md`, 768px), on the assumption that a viewport wide enough implies
          a card wide enough - true until the Script page's mock-02 three-column layout (D85 #3, ADR 0393, superseding
          ADR 0392): there the card's own rendered width (as little as ~520-630px at the 1440px desktop capture) can be
          narrower than the viewport implies, so the cluster overflowed or clipped instead of wrapping (the visual
          suite's retail-sample and markup-dialog states, stage-navigation-and-page-replacement.prd.md Phase 3). A
          container query keys the wrap on the card's actual width in every context it renders in (Script's 2- and
          3-column modes, a narrower Booth/companion panel), not on which viewport implies which reader width.
          40rem (640px) is the card width the fixed-width cluster (Retail sample tag + the 6.5rem stat block + the
          13rem action slot + their gaps + the chevron) needs to sit beside a legible title; below it, the existing
          `max-*` classes below take over unchanged. */}
      <header
        className={`sticky top-[var(--band-h,4rem)] z-10 grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-3 border-[var(--border)] bg-[var(--surface)] p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-[var(--accent)] @min-[40rem]:grid-cols-[1.4rem_minmax(0,1fr)_auto] @min-[40rem]:px-5 @min-[40rem]:py-[0.8rem] ${expanded ? 'rounded-t-lg border-b shadow-[0_2px_6px_color-mix(in_srgb,var(--text)_8%,transparent)]' : 'rounded-lg border-b-0'}`}
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
            <div aria-hidden="true">
              <SectionLabel>{eyebrow}</SectionLabel>
            </div>
          )}
          <h2 className="m-0 font-['Barlow_Condensed',sans-serif] text-[1.2rem] font-semibold">
            <TitleSubtitle title={title} subtitle={subtitle} />
          </h2>
        </button>
        <div className="flex items-center gap-3 justify-self-end text-right @max-[40rem]:col-start-2 @max-[40rem]:justify-self-start">
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
            {onRecordInBooth && (
              <TooltipTarget className="relative z-[1]" text="Read this aloud in the Booth, following your voice">
                <Button variant="ghost" className="text-xs" aria-label={`Record ${title} in Booth`} onClick={onRecordInBooth}>
                  <FontAwesomeIcon icon={faMicrophone} /> Record in Booth
                </Button>
              </TooltipTarget>
            )}
            {showWorkspace ? (
              <TooltipTarget className="relative z-[1]" text="Open in Proof: listen, follow the script and see flags">
                <Button variant="ghost" className="text-xs" aria-label={`Open in Proof for ${title}`} onClick={onWorkspace}>
                  <FontAwesomeIcon icon={faWaveSquare} />
                </Button>
              </TooltipTarget>
            ) : (
              onRecordInBooth && (
                // A credits card can be recorded but has no chapter to open a workspace for: an invisible same-size
                // placeholder keeps its Record in Booth in line with every chapter's down the column.
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
