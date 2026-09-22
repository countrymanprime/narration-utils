import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import { previewParts } from '../../creditsPreviewParts';
import type { CreditsRenderResult } from '../../types';

const KIND_LABEL = { opening: 'Opening credits', closing: 'Closing credits' } as const;

/**
 * A read-only Manuscript pseudo-entry for the narrator's opening or closing credits (PRD
 * audiobook-credits-templates.prd.md, Phase 3: "Read-only credits entries before the first and after the last
 * chapter in the Manuscript view"). Not a chapter: it carries no id in `manuscript.json`, is never returned by
 * `manuscriptChapters()`, and Manuscript.tsx renders it outside the `chapters.map` list so it is excluded from
 * `isListableChapter`, ChapterNav's chapter list and search by construction rather than by a filter that could be
 * forgotten. `preview` is undefined while the library has no matching template (or is still loading); the caller
 * decides whether to render this component at all in that case.
 */
export function CreditsEntry({
  kind,
  preview,
  expanded,
  onToggle,
}: {
  kind: 'opening' | 'closing';
  preview?: CreditsRenderResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const parts = preview ? previewParts(preview) : [];
  const label = KIND_LABEL[kind];
  return (
    <section
      className="relative mx-[var(--reader-inline)] mb-4 overflow-visible rounded-lg border border-[var(--border)] bg-[var(--surface)]"
      data-credits-entry={kind}
      aria-label={label}
    >
      <header
        className={`flex items-center justify-between gap-3 p-3 md:px-5 md:py-[0.8rem] ${expanded ? 'rounded-t-lg border-b border-[var(--border)]' : 'rounded-lg'}`}
      >
        <button className="text-left" aria-expanded={expanded} onClick={onToggle}>
          {/* aria-hidden: a purely decorative eyebrow. Without it the button's accessible name would concatenate
              "Credits" with the heading below, breaking an exact-name lookup ("Opening credits") elsewhere. */}
          <div
            aria-hidden="true"
            className="font-['Barlow_Condensed',sans-serif] text-[0.68rem] font-semibold tracking-[0.08em] uppercase"
            style={{ color: 'var(--text-muted)' }}
          >
            Credits
          </div>
          <h2 className="m-0 font-['Barlow_Condensed',sans-serif] text-[1.2rem] font-semibold">{label}</h2>
        </button>
        <div className="flex items-center gap-3">
          {preview && (
            <div className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-muted)' }}>
              {preview.words.toLocaleString()} words
            </div>
          )}
          <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} style={{ color: 'var(--text-muted)' }} />
        </div>
      </header>
      {expanded && (
        <div className="p-4 text-sm">
          {preview ? (
            <>
              <p className="whitespace-pre-wrap">
                {parts.map((part, index) =>
                  typeof part === 'string' ? (
                    <span key={index}>{part}</span>
                  ) : (
                    <span
                      key={index}
                      className="rounded-[0.15rem] px-[0.15em] py-[0.05em]"
                      style={{ background: 'var(--review-soft)', color: 'var(--review-text)' }}
                    >
                      [{part.token}]
                    </span>
                  ),
                )}
              </p>
              {preview.unresolved.length > 0 && (
                <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {preview.unresolved.length} unresolved token{preview.unresolved.length === 1 ? '' : 's'}: {preview.unresolved.join(', ')}
                </p>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>Nothing to preview yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
