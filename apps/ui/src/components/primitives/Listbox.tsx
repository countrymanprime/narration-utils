import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';

export type ListboxOption = {
  id: string;
  label: ReactNode;
  // A second, muted line under the label (a category and a count).
  description?: ReactNode;
  // A glyph or dot before the label.
  leading?: ReactNode;
};

/** The DOM id of one option, for the combobox's `aria-activedescendant`. */
export const listboxOptionId = (listId: string, optionId: string) => `${listId}-option-${optionId}`;

// A list of choices drawn on the popover surface (mock-fidelity-primitives-and-components.prd.md Phase 7): the frame, radius and
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
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]">
      {options.length > 0 ? (
        <div id={id} role="listbox" aria-label={label} className="flex flex-col">
          {options.map((option, index) => {
            const active = index === activeIndex;
            const selected = option.id === selectedId;
            return (
              <button
                key={option.id}
                id={listboxOptionId(id, option.id)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={selectedId === undefined ? active : selected}
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
              </button>
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
