import { Field as BaseField } from '@base-ui/react/field';
import type { ReactNode } from 'react';

// The look every field label shares: ~14px, Plex Sans 500, --text-muted (mock-fidelity-primitives-and-components.prd.md
// Phase 6). A control with no visible `Field` wrapper (a raw `<label>` beside a `Select`, a read-only value's caption)
// imports this instead of pasting its own copy, so a size fix here reaches every consumer.
export const FIELD_LABEL_CLASSES = 'block text-[0.88rem] font-medium text-[var(--text-muted)]';

// mt-2 (8px) is the mocks' label-to-control gap (mock-fidelity-primitives-and-components.prd.md Phase 6).
const CONTROL_CLASSES =
  'mt-2 w-full rounded-[var(--control-radius)] font-medium border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] data-[invalid]:border-[var(--danger)]';

// A labelled text control. Base UI's Field wires the label, the hint and the error to the control (`for`, `aria-invalid`,
// `aria-describedby`), so none of that is written by hand here (ADR 0047). The control stays controlled: it never holds
// its own value.
export function Field({
  label,
  value,
  onChange,
  onBlur,
  disabled,
  textarea = false,
  placeholder,
  autoFocus,
  hint,
  error,
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  textarea?: boolean;
  placeholder?: string;
  // Focus the control when it mounts: a dialog whose one job is this field opens with it ready (see Dialog's initial focus).
  autoFocus?: boolean;
  // Help that belongs to the field; the control is described by it.
  hint?: ReactNode;
  // What is wrong with the value: shows under the field, marks it `aria-invalid` and describes it (a disabled field shows
  // the error but is not marked invalid: Base UI leaves `aria-invalid` off a disabled control).
  error?: string;
  // A value that must not be shown or kept by the browser (the narrator's own API key): a masked input with the browser's
  // autofill, spell check and autocorrect off. Never with `textarea`.
  secret?: boolean;
}) {
  return (
    <BaseField.Root invalid={Boolean(error)} disabled={disabled} className="text-[0.88rem] font-medium text-[var(--text-muted)] first:mt-3">
      <BaseField.Label className={FIELD_LABEL_CLASSES}>{label}</BaseField.Label>
      <BaseField.Control
        render={
          textarea ? (
            <textarea className={`min-h-20 ${CONTROL_CLASSES}`} />
          ) : secret ? (
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={`min-h-[var(--control-height)] ${CONTROL_CLASSES}`}
            />
          ) : (
            <input className={`min-h-[var(--control-height)] ${CONTROL_CLASSES}`} />
          )
        }
        disabled={disabled}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {hint != null && hint !== false && hint !== '' && (
        <BaseField.Description className="mt-1 block text-xs text-[var(--text-muted)]">{hint}</BaseField.Description>
      )}
      {error && (
        <BaseField.Error match className="mt-1 block text-xs text-[var(--danger-text)]">
          {error}
        </BaseField.Error>
      )}
    </BaseField.Root>
  );
}
