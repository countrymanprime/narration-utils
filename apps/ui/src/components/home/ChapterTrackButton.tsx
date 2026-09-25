import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLayerGroup } from '@fortawesome/free-solid-svg-icons';
import type { ChapterTrackLink } from '../../types';
import { IconButton } from '../primitives/IconButton';
import { TooltipTarget } from '../primitives/Tooltip';
import { chapterTrackButtonLabel, chapterTrackButtonState } from './chapterTrackButtonState';

/**
 * One row's track button (chapter-track-link-control.prd.md Phase 2, TL1): the Tracks navigation icon
 * (`faLayerGroup`), so a narrator recognizes it as "the same place tracks live", with the linked track's own REAPER
 * colour as a dot - never the only signal (WCAG 1.4.1), so every state also has its own badge and accessible name.
 * Opens the chapter's ChapterTrackPanel.
 */
export function ChapterTrackButton({
  chapterTitle,
  link,
  trackColor,
  onClick,
}: {
  chapterTitle: string;
  link: ChapterTrackLink;
  /** The linked/suggested track's REAPER colour, resolved by the caller from ChapterTrackLinks' `tracks` list; empty
   * for no custom colour, matching the Tracks page's own `--non-text` fallback. */
  trackColor?: string;
  onClick: () => void;
}) {
  const state = chapterTrackButtonState(link);
  const label = chapterTrackButtonLabel(chapterTitle, state);
  const dotStyle = { background: trackColor || 'var(--non-text)' };
  return (
    <TooltipTarget text={label}>
      <IconButton label={label} onClick={onClick} className={`relative ${state.kind === 'suggested' ? 'border-dashed' : ''}`} variant="default">
        <FontAwesomeIcon
          icon={faLayerGroup}
          aria-hidden="true"
          style={state.kind === 'not_linked' || state.kind === 'missing' ? { color: 'var(--text-muted)' } : undefined}
        />
        {(state.kind === 'linked' || state.kind === 'renamed' || state.kind === 'suggested') && (
          <span aria-hidden="true" className="absolute right-0.5 bottom-0.5 size-2 rounded-full" style={dotStyle} />
        )}
        {state.kind === 'renamed' && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full text-[0.55rem] font-bold"
            style={{ background: 'var(--info)', color: 'var(--bg)' }}
          >
            i
          </span>
        )}
        {state.kind === 'ambiguous' && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full text-[0.55rem] font-bold"
            style={{ background: 'var(--warn)', color: 'var(--bg)' }}
          >
            {state.count}
          </span>
        )}
        {state.kind === 'missing' && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full text-[0.6rem] font-bold"
            style={{ background: 'var(--danger)', color: 'var(--bg)' }}
          >
            !
          </span>
        )}
      </IconButton>
    </TooltipTarget>
  );
}
