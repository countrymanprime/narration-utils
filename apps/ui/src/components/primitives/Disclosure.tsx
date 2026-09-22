import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible';
import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { ReactNode } from 'react';

// A titled group that opens and closes: the whole title row is the button (a chevron, the title and a short summary of what is
// inside), and the panel under it is not in the page while collapsed. `Collapsible` is the other shape of the same idea, an icon
// button that can sit apart from its panel; use this one when the row itself is the control and a count should be readable while it is
// closed. Base UI supplies `aria-expanded` and links the button to its panel with `aria-controls`.
//
// Controlled: the caller holds `open`, so a group can be opened for a reason of its own (a row was moved into it). `aside` sits beside the
// button, never inside it, because a control inside a button is not valid: it is where an info icon goes.
export function Disclosure({
  title,
  summary,
  open,
  onOpenChange,
  aside,
  className = '',
  children,
}: {
  title: string;
  /** What is inside, in a few words ("2 sections"). It is part of the button's name, so it is read while the group is closed. */
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseCollapsible.Root open={open} onOpenChange={onOpenChange} className={className}>
      <div className="flex items-center gap-1">
        <BaseCollapsible.Trigger className="group flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]">
          <FontAwesomeIcon
            icon={faChevronRight}
            className="size-3 flex-none text-[var(--text-muted)] group-data-[panel-open]:rotate-90 motion-safe:transition-transform"
          />
          <span className="text-sm font-semibold">{title}</span>
          {/* The space is only for the button's name: the two spans are flex items, which drop it from the layout. */}
          {summary && ' '}
          {summary && <span className="min-w-0 text-xs text-[var(--text-muted)]">{summary}</span>}
        </BaseCollapsible.Trigger>
        {aside}
      </div>
      <BaseCollapsible.Panel>{children}</BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}
