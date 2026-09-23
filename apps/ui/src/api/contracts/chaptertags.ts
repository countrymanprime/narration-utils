// Phase 12 (chapter tag embedding) of the reaper-automation-follow-through PRD. Unlike every other bridge
// consumer's contract in this folder, this feature never talks to REAPER: it reads Phase 11's last successful
// "Prepare chapter render" result (per-chapter MP3 titles and paths) and, on explicit confirm, writes ID3v2
// CHAP/CTOC frames into a NEW copy of a narrator-chosen combined-book MP3 - never the per-chapter files, and
// never the chosen file itself. See docs/adr/0099-... for why a combined file, not the per-chapter renders
// themselves, is what gets tagged.

export type ChapterTagsChapter = {
  title: string;
  /** The per-chapter render's predicted path (Phase 11's RENDER_TARGETS); may not exist yet if Render has not
   * been pressed since the last configure. */
  path: string;
  /** Whether that file exists on disk right now. */
  rendered: boolean;
};

export type ChapterTagsPreview = {
  chapters: ChapterTagsChapter[];
  /** True only when there is at least one known chapter and every one of them is rendered; the UI gates the
   * embed action on this. */
  ready: boolean;
};

export type ChapterTagsEmbedResult = {
  /** The new, tagged file's path, beside the one the narrator chose. That file itself is never modified. */
  outputPath: string;
};

export interface ChapterTagsApi {
  /** The chapters Phase 11's last successful configure knows about, and whether each one's file is rendered. */
  chapterTagsPreview(): Promise<ChapterTagsPreview>;
  /** Writes CHAP/CTOC frames for those chapters into a new copy of destPath. Never touches destPath itself. */
  chapterTagsEmbed(destPath: string): Promise<ChapterTagsEmbedResult>;
}
