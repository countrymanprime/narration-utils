// The script markup layer (prep-depth.prd.md Phase 5, ADR 0382): stress, pause and character-tag spans the narrator places
// on the reader's text, kept in the project's narration-utils/prep/markup.json (apps/desktop/internal/prepmarkup) and
// checked against the chapter's current text on every read, so a span over words that changed comes back stale rather
// than drawn on the wrong ones.

export type PrepMarkupKind = 'stress' | 'pause' | 'character_tag';

/** A pause's length: `short` is a breath (one slash), `long` a full pause (two). */
export type PrepMarkupPauseLength = 'short' | 'long';

export type PrepMarkupStaleReason = 'text_changed' | 'paragraph_missing';

export type PrepMarkupSpan = {
  id: string;
  chapterId: string;
  paragraphId: string;
  /** The line's manuscript index (`ManuscriptParagraph.index`), or null when the line is no longer in the chapter. */
  paragraph: number | null;
  /** UTF-16 offsets into the line's text (a JS string index). For a stale span, where it was placed: they may not fit the
   * current line. */
  start: number;
  end: number;
  /** The words the span was placed on. */
  anchorText: string;
  kind: PrepMarkupKind;
  /** The pause length, or the character's name for a tag; empty for stress. */
  value: string;
  /** Where the span starts, counted in non-whitespace characters (how the host tells a whitespace edit from a real one). */
  nonSpaceStart?: number;
  createdAt: string;
  stale: boolean;
  staleReason?: PrepMarkupStaleReason;
};

export type PrepMarkupChapter = { chapterId: string; spans: PrepMarkupSpan[] };

export interface PrepMarkupApi {
  /** A chapter's spans in text order, each checked against the chapter's current text. */
  prepMarkupList(chapterId: string): Promise<PrepMarkupChapter>;
  /** Places one span; whitespace at either edge of the range is left out. The same mark placed twice is kept once. */
  prepMarkupSave(chapterId: string, paragraphId: string, start: number, end: number, kind: PrepMarkupKind, value: string): Promise<PrepMarkupSpan>;
  /** Removes one span by id; a stale span needs nothing else. */
  prepMarkupDelete(chapterId: string, id: string): Promise<void>;
}
