import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { Fragment, type ReactNode } from 'react';

export type ListboxOption = {
  id: string;
  label: ReactNode;
  // A second, muted line under the label (a category and a count).
  description?: ReactNode;
  // A glyph or dot before the label.
  leading?: ReactNode;
  // At the right of the row: a muted count or a key cap.
  trailing?: ReactNode;
  // A heading is drawn before the first option of each run of one group. Absent on every option: no headings.
  group?: string;
  // Off: the row is announced as unavailable and stays in the list. Its `description` should say why.
  disabled?: boolean;
};

/** The DOM id of one option, for the combobox's `aria-activedescendant`. */
export const listboxOptionId = (listId: string, optionId: string) => `${listId}-option-${optionId}`;

// A list of choices drawn on the popover surface: the frame, radius and
// shadow of Popover, undivided rows, the active row on `--surface-2` and the chosen one marked with an `--accent` check
// (read-aloud-control-bar/03). It is the popup of a combobox: focus stays in the text box that drives it, which moves the active
// row with the arrow keys and names it with `aria-activedescendant`, so the options are not in the Tab order; a press picks one.
// `footer` is drawn inside the frame but outside the listbox role, whose children may only be options.
export function Listbox({
  id,
  label,
  options,
  activeIndex,
  selectedId,
  onPick,
  empty,
  footer,
  flush = false,
}: {
  id: string;
  label: string;
  options: readonly ListboxOption[];
  activeIndex?: number;
  selectedId?: string;
  onPick: (id: string) => void;
  // Shown instead of the list when there are no options.
  empty?: ReactNode;
  footer?: ReactNode;
  // Drops the frame, radius and shadow, for a list that sits inside a surface that already has them (the jump menu's dialog).
  flush?: boolean;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden bg-[var(--surface)] ${flush ? '' : 'rounded-[var(--radius-card)] border border-[var(--line-strong)] shadow-[var(--shadow-lg)]'}`}
    >
      {options.length > 0 ? (
        <div id={id} role="listbox" aria-label={label} className="flex flex-col">
          {options.map((option, index) => {
            const active = index === activeIndex;
            const selected = option.id === selectedId;
            const heading = option.group !== undefined && option.group !== options[index - 1]?.group;
            return (
              <Fragment key={option.id}>
                {heading && (
                  <div role="presentation" className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                    {option.group}
                  </div>
                )}
                <button
                  id={listboxOptionId(id, option.id)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={selectedId === undefined ? active : selected}
                  aria-disabled={option.disabled || undefined}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-2)] ${active ? 'bg-[var(--surface-2)]' : ''}`}
                  // A press picks without taking focus from the text box that drives the list.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(option.id)}
                >
                  {selectedId !== undefined && (
                    <span className="w-3.5 flex-none text-[var(--accent)]" aria-hidden="true">
                      {selected && <FontAwesomeIcon icon={faCheck} />}
                    </span>
                  )}
                  {option.leading}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{option.label}</span>
                    {option.description && <span className="block text-xs text-[var(--text-muted)]">{option.description}</span>}
                  </span>
                  {option.trailing && <span className="flex-none text-xs text-[var(--text-muted)]">{option.trailing}</span>}
                </button>
              </Fragment>
            );
          })}
        </div>
      ) : (
        empty && <div className="p-3 text-sm text-[var(--text-muted)]">{empty}</div>
      )}
      {footer && <div className="border-t border-[var(--border)]">{footer}</div>}
    </div>
  );
}
