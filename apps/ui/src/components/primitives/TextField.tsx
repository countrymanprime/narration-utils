import { Input } from '@base-ui/react/input';
import type { ComponentPropsWithRef } from 'react';
import type { ControlNaming } from './controlNaming';

// The look every text control shares. It was copied into each page (and a `FIELD_CLASS` in the Teleprompter, a `controlClass`
// in Settings) and, before that, applied to bare `input` elements by a global rule; the wrapper owns it now (ADR 0053).
// The size is set separately (SANS_CLASSES/MONO_CLASSES): a `text-*` utility can't be layered safely, since two of them in one
// className race for the same CSS property.
const BASE_CLASSES =
  'box-border min-h-[var(--control-height)] w-full rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] leading-[1.35] text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]';
// A colour swatch is a small square, not a field.
const COLOR_CLASSES =
  'size-[2.35rem] rounded-[0.35rem] border border-[var(--border)] bg-[var(--surface)] p-[0.2rem] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]';
const SANS_CLASSES = 'text-[0.88rem]';
// Values that are code, not prose - a hex colour, an id, a number - read a touch larger than body text (mock-fidelity-
// primitives-and-components.prd.md Phase 6: ~15px on the mocks' numeric fields).
const MONO_CLASSES = "text-[0.9375rem] font-['IBM_Plex_Mono',ui-monospace,monospace]";
// A value the app computed that the narrator can read and copy but not edit (Phase 6's migrated fake fields): the same
// control, on --surface-2 instead of --surface, cursor-default, no focus ring.
const READ_ONLY_CLASSES = 'cursor-default bg-[var(--surface-2)] focus-visible:outline-none';

type Props = Omit<ComponentPropsWithRef<'input'>, 'aria-label' | 'id' | 'value' | 'defaultValue' | 'onChange' | 'type' | 'title'> &
  ControlNaming & {
    value: string;
    onChange: (value: string) => void;
    // `color` is the browser's colour picker; no other input type is offered, so a page cannot ask for a native one.
    type?: 'text' | 'color';
    // The typeface for values that are code: a hex colour, an id, a number.
    mono?: boolean;
    // A value the narrator can read and select but not change.
    readOnly?: boolean;
  };

// A bare text input: the control alone, full width of its container, controlled, and `onChange` reports the text, not the
// event. Use `Field` when the control has a visible label, a hint or an error. It passes standard input attributes and the
// ref through (`placeholder`, `disabled`, `onKeyDown`, and the `role` and `aria-*` of the alias combobox), so a widget can build
// on it.
export function TextField({ label, value, onChange, type = 'text', mono = false, readOnly = false, className = '', ...rest }: Props) {
  return (
    <Input
      {...rest}
      type={type}
      aria-label={label}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
      className={`${type === 'color' ? COLOR_CLASSES : `${BASE_CLASSES} ${mono ? MONO_CLASSES : SANS_CLASSES}`} ${readOnly ? READ_ONLY_CLASSES : ''} ${className}`}
    />
  );
}
