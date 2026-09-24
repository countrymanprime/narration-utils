import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookmark as faBookmarkSolid, faMicrophone } from '@fortawesome/free-solid-svg-icons';
import { faBookmark as faBookmarkRegular } from '@fortawesome/free-regular-svg-icons';
import type { ReactNode } from 'react';
import { Button } from '../primitives/Button';
import { TooltipTarget } from '../primitives/Tooltip';

// A chapter card's frame, moved out of Manuscript.tsx unchanged (manuscript-credits-card-parity.prd.md, Phase 1's
// first commit: a pure refactor, no visual change - every manuscript/* capture stays byte identical). `CreditsEntry`
// does not render through this yet; giving it the same card, the whole-header toggle, aria-expanded/aria-controls,
// a chevron and a read-time helper are later commits in the same phase.
export function ReaderCard({
  chapterId,
  title,
  subtitle,
  expanded,
  onToggleExpand,
  bookmarked,
  onToggleBookmark,
  showRetailSample = false,
  showReadAloud = false,
  onReadAloud,
  wordCount,
  children,
}: {
  chapterId: string;
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggleExpand: () => void;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  showRetailSample?: boolean;
  showReadAloud?: boolean;
  onReadAloud?: () => void;
  wordCount: number;
  children: ReactNode;
}) {
  return (
    <article
      className="relative mx-[var(--reader-inline)] mb-4 scroll-mt-[var(--band-h,4rem)] overflow-visible rounded-lg border border-[var(--border)] bg-[var(--surface)]"
      data-chapter={title}
      data-chapter-id={chapterId}
    >
      <header
        className={`sticky top-[var(--band-h,4rem)] z-10 grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-3 border-[var(--border)] bg-[var(--surface)] p-3 md:grid-cols-[1.4rem_minmax(0,1fr)_auto] md:px-5 md:py-[0.8rem] ${expanded ? 'rounded-t-lg border-b shadow-[0_2px_6px_color-mix(in_srgb,var(--text)_8%,transparent)]' : 'rounded-lg border-b-0'}`}
      >
        <TooltipTarget className="-ml-1 flex size-[1.4rem]" text={bookmarked ? 'Remove chapter bookmark' : 'Bookmark this chapter'}>
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
        <button className="text-left" onClick={onToggleExpand}>
          <h2 className="m-0 font-['Barlow_Condensed',sans-serif] text-[1.2rem] font-semibold">
            {title} {subtitle && <span className="font-['IBM_Plex_Mono',monospace] text-[0.8rem] font-normal text-[var(--text-muted)]">— {subtitle}</span>}
          </h2>
        </button>
        <div className="flex items-center gap-3 justify-self-end text-right max-md:col-start-2 max-md:justify-self-start">
          {showRetailSample && (
            <span className="rounded-[0.2rem] px-1.5 py-0.5 text-xs font-medium" style={{ background: 'var(--place-soft)', color: 'var(--info-text)' }}>
              Retail sample
            </span>
          )}
          {showReadAloud && (
            <TooltipTarget text="Read this chapter aloud and follow along">
              <Button variant="ghost" className="text-xs" aria-label={`Read ${title} aloud`} onClick={onReadAloud}>
                <FontAwesomeIcon icon={faMicrophone} /> Read aloud
              </Button>
            </TooltipTarget>
          )}
          <div>
            <div className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs">{wordCount.toLocaleString()} words</div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              ~{Math.max(1, Math.round(wordCount / 200))} min read
            </div>
          </div>
        </div>
      </header>
      {expanded && <div className="manuscript-reader mx-auto overflow-hidden rounded-b-lg">{children}</div>}
    </article>
  );
}
