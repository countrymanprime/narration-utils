import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { TextField } from './TextField';
import { TooltipTarget } from './Tooltip';

const TAG_FONT = "font-['IBM_Plex_Mono',monospace] text-[0.8rem]";

// A list of terms the user keeps (the Proofing vocabulary hints): the ones accepted as chips with a remove cross, the ones
// only suggested as dashed chips that a press accepts, a box to type a new term into (Enter or the Add button submits), and a
// slot for other actions beside it. It owns the draft text only: it never edits the lists, it reports `onAdd(text)`,
// `onRemove(tag)` and `onAcceptSuggestion(term)` and the caller decides what the text means (splitting, duplicates, saving),
// as the vocabulary hints do. Everything is one `role="group"` named by `label`. After a chip is removed the cursor goes back
// to the typing box, since the cross that had focus is gone.
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
  // Shown in the chip box while there is neither a tag nor a suggestion.
  emptyText: string;
  suggestionHint?: string;
  onAdd: (text: string) => void;
  onRemove: (tag: string) => void;
  onAcceptSuggestion: (term: string) => void;
  // Buttons that sit after Add in the typing row.
  actions?: ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    const text = draft;
    setDraft('');
    if (text.trim()) onAdd(text);
  };
  return (
    <div role="group" aria-label={label}>
      <div className="flex min-h-11 flex-wrap gap-2 rounded-md p-2" style={{ border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
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
        {tags.length === 0 && suggestions.length === 0 && <span className="text-xs text-[var(--text)]">{emptyText}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="w-48">
          <TextField
            ref={inputRef}
            label={inputLabel}
            value={draft}
            placeholder={placeholder}
            onChange={setDraft}
            onKeyDown={(event) => {
              // Enter that commits an input-method composition is not a submit.
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              submit();
            }}
          />
        </div>
        <Button variant="ghost" onClick={submit}>
          Add
        </Button>
        {actions}
      </div>
    </div>
  );
}
