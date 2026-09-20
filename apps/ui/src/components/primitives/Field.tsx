import { Field as BaseField } from '@base-ui/react/field';
import type { ReactNode } from 'react';

const CONTROL_CLASSES =
  'mt-1 w-full rounded-[var(--control-radius)] font-medium border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)] data-[invalid]:border-[var(--danger)]';

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
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  textarea?: boolean;
  // Help that belongs to the field; the control is described by it.
  hint?: ReactNode;
  // What is wrong with the value: shows under the field, marks it `aria-invalid` and describes it (a disabled field shows
  // the error but is not marked invalid: Base UI leaves `aria-invalid` off a disabled control).
  error?: string;
}) {
  return (
    <BaseField.Root invalid={Boolean(error)} disabled={disabled} className="text-[0.82rem] font-medium text-[var(--text-muted)] first:mt-3">
      <BaseField.Label className="block text-[0.82rem] font-medium text-[var(--text-muted)]">{label}</BaseField.Label>
      <BaseField.Control
        render={textarea ? <textarea className={`min-h-20 ${CONTROL_CLASSES}`} /> : <input className={`min-h-[var(--control-height)] ${CONTROL_CLASSES}`} />}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {hint != null && hint !== false && hint !== '' && (
        <BaseField.Description className="mt-1 block text-xs text-[var(--text-muted)]">{hint}</BaseField.Description>
      )}
      {error && (
        <BaseField.Error match className="mt-1 block text-xs text-[var(--danger)]">
          {error}
        </BaseField.Error>
      )}
    </BaseField.Root>
  );
}
