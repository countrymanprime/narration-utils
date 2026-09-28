// Assigns a stable colour per speaker (D85 #6 on #509, ADR 0367): the Script reader's speaker attribution
// (manuscript/ParagraphView.tsx via the primitives/SpeakerTag chip) and the Booth's "Voices in scene" tags
// (booth/BoothView.tsx, via Highlight's colorToken override) both call this, so the same speaker id lands on the
// same colour in both places.

/** How many distinct speaker colours styles.css declares (--speaker-1..--speaker-N). */
export const SPEAKER_COLOR_COUNT = 7;

// A small, dependency-free string hash (djb2), not cryptographic: it only needs to spread names evenly across
// SPEAKER_COLOR_COUNT buckets, deterministically, across paragraphs, sessions and reloads.
function hash(id: string): number {
  let value = 5381;
  for (let index = 0; index < id.length; index++) value = ((value << 5) + value + id.charCodeAt(index)) | 0;
  return value >>> 0;
}

/** The 1-based index into the speaker colour tokens for a speaker id (a name or a Story Bible entity id - whichever
 * the caller already has). The same id always maps to the same index; an eighth or later distinct speaker wraps back
 * to 1, which is `--speaker-1` (an alias of `--character`, styles.css) - the app's own colour for a speaker before
 * this batch, so overflow and "no id at all" resolve to the same tone. */
export function speakerColorIndex(speakerId: string | undefined): number {
  if (!speakerId) return 1;
  return (hash(speakerId) % SPEAKER_COLOR_COUNT) + 1;
}

/** The bare custom-property name for a speaker's colour, e.g. `--speaker-3` (styles.css). For a caller composing its
 * own `var()` expression, or reading the `-text` companion directly (`${speakerColorToken(id)}-text`). */
export function speakerColorToken(speakerId: string | undefined): string {
  return `--speaker-${speakerColorIndex(speakerId)}`;
}
