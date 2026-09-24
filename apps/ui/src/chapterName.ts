// One rule for a chapter's name everywhere it is shown (chapter-title-display-consistency.prd.md): title and subtitle
// join with " — " (space, em dash, space) in source casing, never CSS capitals, never italic or monospace. This is the
// only place that formats one into plain text; primitives/TitleSubtitle.tsx is the only place that renders it as markup.
// Read chapterNameFormatting.test.ts before adding another site that reads `.subtitle` directly.

export interface ChapterNameInput {
  title: string;
  subtitle?: string;
}

// A context prefix ("Read aloud", "Recording check", "Stage suggestion"), built with context(). Kept distinct from
// 'full'/'short' so a caller cannot pass an arbitrary string where a form is expected.
export interface ChapterNameContext {
  readonly prefix: string;
}

export type ChapterNameForm = 'full' | 'short' | ChapterNameContext;

export function context(prefix: string): ChapterNameContext {
  return { prefix };
}

const WHITESPACE = /\s+/g;
// A separator the title already ends with, so appending " — subtitle" cannot double up ("CHAPTER ONE: — Subtitle").
const TRAILING_SEPARATOR = /[:—–-]\s*$/;

function squash(text: string): string {
  return text.replace(WHITESPACE, ' ').trim();
}

// A legacy title that still holds its subtitle after a literal "\n" (three Go/Python helpers used to join these with
// ": " - see chapterName.test.ts), read the same way the importers' headingParts splits a heading: the first line is
// the title, every later line joins into the subtitle.
function splitLegacyNewline(title: string): { title: string; subtitle?: string } {
  if (!title.includes('\n')) return { title: squash(title) };
  const [first, ...rest] = title.split('\n');
  const subtitle = squash(rest.join(' '));
  return { title: squash(first ?? ''), subtitle: subtitle || undefined };
}

function fullName(title: string, subtitle: string | undefined): string {
  if (!subtitle) return title;
  const stripped = title.replace(TRAILING_SEPARATOR, '').trim();
  return stripped ? `${stripped} — ${subtitle}` : subtitle;
}

// The chapter's name as plain text. 'full' (the default) is "Title — Subtitle", or the title alone when there is no
// subtitle. 'short' is always the title alone - for a control inside a row that already shows the full name. A context
// prefix (context('Read aloud')) gives "Prefix: Title — Subtitle".
export function chapterName(chapter: ChapterNameInput, form: ChapterNameForm = 'full'): string {
  const legacy = splitLegacyNewline(chapter.title);
  const title = legacy.title;
  const subtitle = chapter.subtitle !== undefined ? squash(chapter.subtitle) || undefined : legacy.subtitle;

  if (typeof form === 'object') return `${form.prefix}: ${fullName(title, subtitle)}`;
  if (form === 'short') return title;
  return fullName(title, subtitle);
}
