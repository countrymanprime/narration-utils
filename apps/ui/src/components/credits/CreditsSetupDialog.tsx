import { useState } from 'react';
import { apiErrorMessage } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import type { CreditsSetupState, CreditValues, DetectedCandidate } from '../../types';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { Dialog } from '../primitives/Dialog';
import { Field } from '../primitives/Field';
import type { Notify } from '../primitives/Toast';

// A DetectedCandidate's token is a credits.Values Go field name ("Title", "CopyrightHolder"), matching CreditsPanel's
// own map (detectedToken there goes the other way, lowerCamelCase to this form).
const CANDIDATE_LABELS: Record<string, string> = {
  Title: 'Title',
  Subtitle: 'Subtitle',
  Author: 'Author',
  Series: 'Series',
  BookNumber: 'Book Number',
  Copyright: 'Copyright',
  Year: 'Year',
  CopyrightHolder: 'Copyright Holder',
  Publisher: 'Publisher',
};

function humanList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// The caption under a prefilled field: its source, which of the manuscript's lines it came from (CS1's mockup:
// "From the title page, lines 1–3: AFTER / THE / APPLAUSE"), whether an all-capitals line was recased for the field
// (CS3) and, for a low-confidence guess, "(check this)" (Solution Detail, Confidence table).
function candidateCaption(candidate: DetectedCandidate): string {
  let caption = `From ${candidate.source}`;
  if (candidate.lines && candidate.lines.length > 0) {
    caption += candidate.lines.length > 1 ? `, lines 1–${candidate.lines.length}: ${candidate.lines.join(' / ')}` : `, line 1: ${candidate.lines[0]}`;
    const allCapsLines = candidate.lines.every((line) => /[A-Z]/.test(line) && !/[a-z]/.test(line));
    if (allCapsLines && /[a-z]/.test(candidate.value)) caption += ' (recased)';
  }
  if (candidate.confidence === 'low') caption += ' (check this)';
  return caption;
}

/**
 * "Set up the credits" (credits-token-setup-and-front-matter-detection.prd.md, Phase 2; CS1 C / D35, ADR 0208): a
 * dialog shown once per project when `CreditsSetupState.needed` is true. Every field is prefilled from its detected
 * candidate (CS6) and captioned with its source, so the narrator sees exactly what will be written before they write
 * it (mockups/credits-token-setup-and-front-matter-detection/01-setup-dialog-on-open.webp). Save fills only the
 * fields the narrator confirms (`creditsSetupSave` never replaces a value already set); "Not now" dismisses for this
 * session only, and "Don't ask for this project" dismisses until a Replace manuscript (CS2).
 */
export function CreditsSetupDialog({
  state,
  onDone,
  onMoreFields,
  notify,
}: {
  state: CreditsSetupState;
  /** Called with the host's answer after any of the three actions, so the caller (Home) can drop the dialog. */
  onDone: (next: CreditsSetupState) => void;
  /** "Settings > Credits" (CS4's "More fields" link): the fields this dialog does not ask for, detected but waiting there. */
  onMoreFields: () => void;
  notify: Notify;
}) {
  const api = useApi();
  const [values, setValues] = useState<Partial<Record<keyof CreditValues, string>>>(() =>
    Object.fromEntries(state.fields.map((field) => [field.field, field.candidate?.value ?? ''])),
  );
  // CS7 B: offered only while the global default is empty (the only reason Narrator is ever among `fields`, see Evidence),
  // checked by default so a first answer becomes every project's default.
  const [useForAllProjects, setUseForAllProjects] = useState(true);
  const [busy, setBusy] = useState(false);
  const asksForNarrator = state.fields.some((field) => field.field === 'narrator');
  const askedTokens = new Set(state.fields.map((field) => field.token));
  const moreFields = state.candidates.filter((candidate) => !askedTokens.has(candidate.token));

  const run = async (action: () => Promise<CreditsSetupState>) => {
    setBusy(true);
    try {
      onDone(await action());
    } catch (error) {
      notify(apiErrorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const narrator = values.narrator?.trim();
      if (asksForNarrator && useForAllProjects && narrator) {
        await api.saveSettings('General', 'global', { narrator_name: narrator });
      }
      return api.creditsSetupSave(values);
    });
  const notNow = () => run(() => api.creditsSetupDismiss('session'));
  const dontAsk = () => run(() => api.creditsSetupDismiss('project'));

  const fieldCount = state.fields.length;

  return (
    <Dialog
      title="Set up the credits"
      description={`Your opening and closing credits need ${fieldCount} value${fieldCount === 1 ? '' : 's'}. We filled in what the manuscript already says; check them and save.`}
      onClose={() => void notNow()}
      actions={
        <>
          <Button variant="ghost" type="button" disabled={busy} onClick={() => void dontAsk()}>
            Don&rsquo;t ask for this project
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" type="button" disabled={busy} onClick={() => void notNow()}>
              Not now
            </Button>
            <Button variant="primary" type="button" disabled={busy} pending={busy} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-3">
        {state.fields.map((field, index) => (
          <div key={field.field}>
            <Field
              label={field.token}
              value={values[field.field] ?? ''}
              disabled={busy}
              autoFocus={index === 0}
              onChange={(value) => setValues((current) => ({ ...current, [field.field]: value }))}
            />
            {field.candidate ? (
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {candidateCaption(field.candidate)}
              </p>
            ) : field.field === 'narrator' ? (
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Not set yet: nothing in the manuscript names the narrator.
              </p>
            ) : null}
            {field.field === 'narrator' && (
              <Checkbox checked={useForAllProjects} disabled={busy} onChange={setUseForAllProjects}>
                Use for all my projects (saved as your default in Settings &gt; General)
              </Checkbox>
            )}
          </div>
        ))}
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Only empty values are filled in; nothing you have already set is changed.
          {moreFields.length > 0 && (
            <>
              {' '}
              {humanList(moreFields.map((candidate) => CANDIDATE_LABELS[candidate.token] ?? candidate.token))} {moreFields.length === 1 ? 'was' : 'were'} also
              found and {moreFields.length === 1 ? 'is' : 'are'} waiting in{' '}
              <button type="button" className="underline" onClick={onMoreFields}>
                Settings &gt; Credits
              </button>
              .
            </>
          )}
        </p>
      </div>
    </Dialog>
  );
}
