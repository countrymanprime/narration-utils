import { previewParts } from '../../creditsPreviewParts';
import { creditsParagraphs } from '../teleprompter/readerModel';
import type { CreditsRenderResult } from '../../types';
import { Button } from '../primitives/Button';
import { ReaderCard } from './ReaderCard';

const KIND_LABEL = { opening: 'Opening credits', closing: 'Closing credits' } as const;

/**
 * The narrator's opening or closing credits, on the same Manuscript card a chapter uses
 * (manuscript-credits-card-parity.prd.md, Phase 1: "the credits panel ... needs to work the same for consistency").
 * Not a chapter: it carries no id in `manuscript.json`, is never returned by `manuscriptChapters()`, and Manuscript.tsx
 * renders it outside the `chapters.map` list so it is excluded from `isListableChapter`, ChapterNav's chapter list and
 * search by construction rather than by a filter that could be forgotten. `preview` is undefined while the library has
 * no matching template (or is still loading); the caller decides whether to render this component at all in that case.
 */
export function CreditsEntry({
  kind,
  preview,
  expanded,
  onToggle,
  textClass,
  onFillIn,
}: {
  kind: 'opening' | 'closing';
  preview?: CreditsRenderResult;
  expanded: boolean;
  onToggle: () => void;
  /** The reader's Text size setting (MC3): credits rows follow it exactly as chapter paragraphs do. */
  textClass: string;
  /** "Fill in" (credits-token-setup-and-front-matter-detection.prd.md, Phase 3): opens the same setup dialog Home does,
   * shown beside the unresolved-token line whenever there is one to show. Omitted, the line renders with no button (a
   * caller that has not wired the dialog up yet). */
  onFillIn?: () => void;
}) {
  const label = KIND_LABEL[kind];
  const lines = preview ? creditsParagraphs(kind, preview.text) : [];
  return (
    <ReaderCard creditsKind={kind} eyebrow="Credits" title={label} expanded={expanded} onToggleExpand={onToggle} wordCount={preview?.words ?? 0}>
      {preview ? (
        <div className="relative bg-[var(--surface)]">
          {lines.map((line, index) => (
            <div key={line.id} className={`min-h-8 border-b border-[var(--border)] px-4 py-1 last:border-b-0 ${index % 2 === 1 ? 'bg-[var(--row-alt)]' : ''}`}>
              <p className={`${textClass} whitespace-pre-line`}>
                {previewParts({ ...preview, text: line.text }).map((part, partIndex) =>
                  typeof part === 'string' ? (
                    <span key={partIndex}>{part}</span>
                  ) : (
                    <span
                      key={partIndex}
                      className="rounded-[0.15rem] px-[0.15em] py-[0.05em]"
                      style={{ background: 'var(--review-soft)', color: 'var(--review-text)' }}
                    >
                      [{part.token}]
                    </span>
                  ),
                )}
              </p>
            </div>
          ))}
          {preview.unresolved.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-4">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {preview.unresolved.length} unresolved token{preview.unresolved.length === 1 ? '' : 's'}: {preview.unresolved.join(', ')}
              </p>
              {onFillIn && (
                <Button variant="ghost" type="button" className="px-2 py-0.5 text-[0.7rem] normal-case" onClick={onFillIn}>
                  Fill in
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          Nothing to preview yet.
        </p>
      )}
    </ReaderCard>
  );
}
