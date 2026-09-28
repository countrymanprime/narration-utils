import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { PrepMarkupSpan } from '../../types';
import { Button } from '../primitives/Button';
import { describeMark, markName, removeMarkLabel } from './markup';

// A script mark on the reader's text (prep-depth.prd.md Phase 5, ADR 0382). Stress is a dotted accent underline under the
// words, a pause is one slash (a breath) or two (a pause) after them, and a character tag is a small name chip before
// them, after the concept mock (docs/prds/mockups/prep-depth/02-prep-script-concept.webp). The slash and the chip are CSS
// generated content, never text in the DOM: the selection offsets (useTextSelection) and every reader of the line's words
// see the manuscript's text and nothing else. The mark is not a control: an entity or note highlight around it keeps the
// only click target, so nothing interactive nests (the marks are managed from the Mark up dialog).
//
// `first` and `last` say whether this piece starts or ends the span: a span split by another highlight is drawn in
// several pieces, and only its first carries the chip and only its last the slash.
const STRESS_CLASS = 'underline decoration-dotted decoration-2 underline-offset-[0.22em] [text-decoration-color:var(--accent)]';
const PAUSE_CLASS = 'after:ml-[0.12em] after:font-bold after:text-[var(--accent-strong)] after:content-[attr(data-pause-glyph)]';
const TAG_CLASS = [
  'before:mr-[0.3em] before:inline-block before:rounded-[0.2rem] before:px-[0.3em] before:align-[0.1em]',
  "before:font-['Barlow_Condensed',sans-serif] before:text-[0.66em] before:leading-[1.45] before:font-semibold before:tracking-[0.06em] before:uppercase",
  'before:bg-[var(--character-soft)] before:text-[var(--character-text)] before:content-[attr(data-speaker)]',
].join(' ');

export function MarkupMark({ span, first, last, children }: { span: PrepMarkupSpan; first: boolean; last: boolean; children: ReactNode }) {
  const showTag = span.kind === 'character_tag' && first;
  const showPause = span.kind === 'pause' && last;
  const className = [span.kind === 'stress' ? STRESS_CLASS : '', showPause ? PAUSE_CLASS : '', showTag ? TAG_CLASS : ''].filter(Boolean).join(' ');
  return (
    <span
      data-markup={span.kind}
      data-speaker={showTag ? span.value : undefined}
      data-pause={showPause ? span.value : undefined}
      data-pause-glyph={showPause ? (span.value === 'long' ? '//' : '/') : undefined}
      aria-description={(span.kind === 'character_tag' ? first : last) ? describeMark(span) : undefined}
      className={className || undefined}
    >
      {children}
    </span>
  );
}

// Where a mark no longer fits the text (Q6): said beside the line, never drawn on it, with a Remove that needs only the
// mark's id. `gone` is the list above a chapter of marks whose line is no longer in it.
export function StaleMarkupNotice({ spans, gone = false, remove }: { spans: PrepMarkupSpan[]; gone?: boolean; remove?: (span: PrepMarkupSpan) => void }) {
  if (!spans.length) return null;
  return (
    <div role="note" className="mt-1 space-y-1 text-xs" style={{ color: 'var(--warn-text)' }}>
      {spans.map((span) => (
        <div key={span.id} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-stale-markup={span.id}>
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          <span>
            {gone ? (
              <>
                The {markName(span)} on “{span.anchorText}” is on a line that is no longer in this chapter.
              </>
            ) : (
              <>
                Text changed here: the {markName(span)} on “{span.anchorText}” no longer matches this line.
              </>
            )}
          </span>
          {remove && (
            <Button size="sm" variant="secondary" aria-label={removeMarkLabel(span)} onClick={() => remove(span)}>
              Remove
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
