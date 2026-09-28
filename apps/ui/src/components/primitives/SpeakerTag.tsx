import type { KeyboardEvent, MouseEvent } from 'react';
import { badgeClass } from './StatusBadge';
import { speakerColorToken } from './speakerColor';

// THE badge's tag shape (StatusBadge.tsx, ADR 0600): the Script's speaker tag is a 16 px tag (mock 02), and the Booth's,
// beside a line read at the booth's script size, the 26 px `booth` tag (mock 03). Only the placement is this file's.
const PLACEMENT = 'mr-2 align-middle';

type Props = {
  label: string;
  /** The id a speaker's colour is hashed from (speakerColor.ts): a Story Bible entity id where one exists, or the
   * resolved display name where it does not. Defaults to `label`, so a caller with no separate id still gets a
   * stable, deterministic colour. */
  speakerId?: string;
  /** Opens the speaker's Story Bible entry (mirrors Highlight's own onActivate), the Booth's "Voices in scene" use. */
  onActivate?: () => void;
  description?: string;
  /** `booth`: the Booth's larger tag beside the script (booth/ReaderText). */
  size?: 'tag' | 'booth';
};

/** A speaker's colour, the same one Highlight's `colorToken` override draws with for the Booth's "Voices in scene"
 * tags (booth/BoothView.tsx): both read the token names from speakerColor.ts, so a speaker's colour is the same
 * wherever the app names them (D85 #6, ADR 0367). */
export function SpeakerTag({ label, speakerId, onActivate, description, size = 'tag' }: Props) {
  const token = speakerColorToken(speakerId ?? label);
  const style = { background: `color-mix(in srgb, var(${token}) 20%, transparent)`, color: `var(${token}-text)`, borderColor: 'transparent' };
  const classes = `${badgeClass(size)} ${PLACEMENT}`;
  if (!onActivate)
    return (
      <span data-speaker-tag className={classes} style={style} aria-description={description}>
        {label}
      </span>
    );
  const activate = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    onActivate();
  };
  return (
    <span
      role="button"
      tabIndex={0}
      data-speaker-tag
      aria-label={label}
      aria-description={description}
      className={`${classes} cursor-pointer`}
      style={style}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate(event);
      }}
    >
      {label}
    </span>
  );
}
