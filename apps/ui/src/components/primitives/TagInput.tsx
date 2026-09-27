import { Input } from '@base-ui/react/input';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { TooltipTarget } from './Tooltip';

const TAG_FONT = "font-['IBM_Plex_Mono',monospace] text-[0.8rem]";
// A term this long already reads as a mistake, not a vocabulary hint (ADR 0363's companion limit, V5).
const MAX_TERM_LENGTH = 64;

// A list of terms the user keeps (the Proofing vocabulary hints): the ones accepted as chips with a remove cross, the ones
// only suggested as dashed chips that a press accepts, and a typing box inline in the same row - the pill box is the input,
// there is no separate Add row. It owns the draft text only: it never edits the lists, it reports `onAdd(text)`,
// `onRemove(tag)` and `onAcceptSuggestion(term)` and the caller decides what the text means (splitting, duplicates, saving),
// as the vocabulary hints do. Everything is one `role="group"` named by `label`. After a chip is removed the cursor goes back
// to the typing box, since the cross that had focus is gone.
//
// Keyboard: Enter or a typed comma commits the draft (a term never holds a comma); blur commits it too, so a click on
// Remove, the Suggest action or a page's own submit button never loses what was just typed (the blur fires, and its
// commit lands, before that click's own handler runs - the DOM's own event order, not a workaround here). Backspace on
// an empty draft removes the most recently added tag (ADR 0363, superseding 0055's opposite decision). A paste that
// contains a comma or newline commits at once instead of sitting as draft text needing a further Enter; an ordinary
// single-term paste is left as draft text like typing it would be.
export function TagInput({
  label,
  inputLabel,
  placeholder,
  tags,
  suggestions,
  emptyText,
  suggestionHint = 'Suggested — click to accept',
  onAdd,
  onRemove,
  onAcceptSuggestion,
  actions,
}: {
  label: string;
  // The typing box's accessible name.
  inputLabel: string;
  placeholder?: string;
  tags: readonly string[];
  suggestions: readonly string[];
  // Shown in the chip box while there is neither a tag nor a suggestion nor draft text (once typing starts, the
  // placeholder alone is enough - the two would otherwise read as one run-on sentence).
  emptyText: string;
  suggestionHint?: string;
  onAdd: (text: string) => void;
  onRemove: (tag: string) => void;
  onAcceptSuggestion: (term: string) => void;
  // Other actions that sit inside the box, at its trailing edge (the Proofing page's Suggest icon).
  actions?: ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = (text: string) => {
    if (text.trim()) onAdd(text);
  };
  const submit = () => {
    const text = draft;
    setDraft('');
    commit(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter that commits an input-method composition is not a submit.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' || event.key === ',') {
      // A term never holds a comma (Phase 1): typing one commits the draft instead of inserting it.
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      // ADR 0363: Backspace on an empty draft removes the most recently added tag.
      event.preventDefault();
      onRemove(tags[tags.length - 1]);
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/[,\r\n]/.test(text)) return; // A single term: let it land as draft text like typing it would.
    event.preventDefault();
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    setDraft('');
    commit(draft.slice(0, start) + text + draft.slice(end));
  };
  return (
    <div role="group" aria-label={label}>
      <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-md p-2" style={{ border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        {tags.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-[0.35rem] rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-[0.55rem] py-[0.3rem] ${TAG_FONT} text-[var(--accent-strong)]`}
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => {
                onRemove(tag);
                inputRef.current?.focus();
              }}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </span>
        ))}
        {suggestions.map((term) => (
          <TooltipTarget key={term} text={suggestionHint}>
            <button
              type="button"
              aria-description={suggestionHint}
              className={`inline-flex items-center gap-[0.35rem] rounded-full border border-dashed border-[var(--border)] bg-transparent px-[0.55rem] py-[0.3rem] ${TAG_FONT} text-[var(--text)]`}
              onClick={() => onAcceptSuggestion(term)}
            >
              + {term}
            </button>
          </TooltipTarget>
        ))}
        {tags.length === 0 && suggestions.length === 0 && draft === '' && <span className="text-xs text-[var(--text)]">{emptyText}</span>}
        <Input
          ref={inputRef}
          aria-label={inputLabel}
          value={draft}
          placeholder={placeholder}
          maxLength={MAX_TERM_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={submit}
          className="min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-[0.88rem] leading-[1.35] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
        />
        {actions}
      </div>
    </div>
  );
}
