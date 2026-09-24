import { chapterName } from '../../chapterName';
import { TooltipTarget } from './Tooltip';

// A chapter's title and subtitle, drawn one way everywhere (chapter-title-display-consistency.prd.md, ADR 0058's Heading
// precedent for a muted line): the title semibold, the subtitle `--text-muted` and regular, both in source casing and the
// context's own font family. Generic on purpose - a book title or an import-section name can use it too.
//
// `inline` (the default) is one text run: "Title — Subtitle". `stacked` puts the title over a muted subtitle line, with a
// visually hidden " — " between them so a screen reader hears the same name either way.
export function TitleSubtitle({
  title,
  subtitle,
  layout = 'inline',
  truncate = false,
  className = '',
}: {
  title: string;
  subtitle?: string;
  layout?: 'inline' | 'stacked';
  // Clips from the end instead of wrapping. Inline: one run, with the full name in a tooltip (ADR 0049) since the text
  // itself is cut. Stacked: each line clips on its own; the title and, when it is the one that runs out of room, the
  // subtitle stay each on one line rather than wrapping to a second.
  truncate?: boolean;
  className?: string;
}) {
  if (layout === 'stacked') {
    return (
      <span className={`normal-case ${className}`}>
        <span className={`block font-semibold ${truncate ? 'truncate' : ''}`}>{title}</span>
        {subtitle && (
          <span className={`block font-normal text-[var(--text-muted)] ${truncate ? 'truncate' : ''}`}>
            <span className="sr-only"> — </span>
            {subtitle}
          </span>
        )}
      </span>
    );
  }

  const inline = (
    <span className={`normal-case ${truncate ? 'block truncate' : ''} ${className}`}>
      <span className="font-semibold">{title}</span>
      {subtitle && (
        <span className="font-normal text-[var(--text-muted)]">
          {' '}— {subtitle}
        </span>
      )}
    </span>
  );
  if (!truncate) return inline;
  return (
    <TooltipTarget text={chapterName({ title, subtitle })} inline>
      {inline}
    </TooltipTarget>
  );
}
