import { useState } from 'react';
import type { PrepMarkupKind, PrepMarkupSpan } from '../../types';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import { Field } from '../primitives/Field';
import { RadioGroup } from '../primitives/RadioGroup';
import { SectionLabel } from '../primitives/SectionLabel';
import { markName, removeMarkLabel } from './markup';

// Places a script mark on the selected words (prep-depth.prd.md Phase 5): stress, a breath or a pause after them, or who
// speaks them. The marks already on these words are listed with their own Remove, which is how a mark is taken off: the
// marks on the text are not controls (see MarkupMark).
type Choice = 'stress' | 'breath' | 'pause' | 'speaker';

const CHOICES = [
  { value: 'stress', label: 'Stress', description: 'Lean on these words (a dotted underline).' },
  { value: 'breath', label: 'Breath', description: 'A short breath after them (/).' },
  { value: 'pause', label: 'Pause', description: 'A full pause after them (//).' },
  { value: 'speaker', label: 'Speaker', description: 'Who speaks these words (a name chip before them).' },
] as const;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Enough Story Bible characters to be one press away without turning the dialog into a list.
const MAX_CHARACTER_CHOICES = 8;

const TO_MARK: Record<Exclude<Choice, 'speaker'>, [PrepMarkupKind, string]> = {
  stress: ['stress', ''],
  breath: ['pause', 'short'],
  pause: ['pause', 'long'],
};

export function MarkupDialog({
  anchorText,
  characters,
  existing,
  confirm,
  remove,
  cancel,
}: {
  anchorText: string;
  /** The Story Bible's characters, offered as one-press speaker names. */
  characters: string[];
  /** The marks already on (or overlapping) the selected words. */
  existing: PrepMarkupSpan[];
  confirm: (kind: PrepMarkupKind, value: string) => void;
  remove: (span: PrepMarkupSpan) => void;
  cancel: () => void;
}) {
  const [choice, setChoice] = useState<Choice>('stress');
  const [speaker, setSpeaker] = useState('');
  const ready = choice !== 'speaker' || speaker.trim() !== '';
  const add = () => {
    if (choice === 'speaker') confirm('character_tag', speaker.trim());
    else confirm(...TO_MARK[choice]);
  };
  return (
    <Dialog
      title="Mark up"
      onClose={cancel}
      actions={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} onClick={add}>
            Add mark
          </Button>
        </>
      }
    >
      <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
        Mark up: “{anchorText}”
      </p>
      <div className="mt-3">
        <RadioGroup label="Mark" value={choice} onChange={setChoice} options={CHOICES} />
      </div>
      {choice === 'speaker' && (
        <div className="mt-3">
          <Field label="Speaker name" value={speaker} onChange={setSpeaker} autoFocus hint="A Story Bible character, or any name." />
          {characters.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {characters.slice(0, MAX_CHARACTER_CHOICES).map((name) => (
                <Button key={name} variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => setSpeaker(name)}>
                  {name}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      {existing.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <SectionLabel as="div" className="mb-1">
            Already on these words
          </SectionLabel>
          <ul className="space-y-1 text-sm">
            {existing.map((span) => (
              <li key={span.id} className="flex items-center justify-between gap-2">
                <span>
                  {capitalize(markName(span))} on “{span.anchorText}”
                </span>
                <Button variant="ghost" className="px-1.5 py-0 text-xs" aria-label={removeMarkLabel(span)} onClick={() => remove(span)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
