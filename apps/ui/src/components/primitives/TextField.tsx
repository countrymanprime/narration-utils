import { Input } from '@base-ui/react/input';
import type { ComponentPropsWithRef } from 'react';
import type { ControlNaming } from './controlNaming';

// The look every text control shares. It was copied into each page (and a `FIELD_CLASS` in the Teleprompter, a `controlClass`
// in Settings) and, before that, applied to bare `input` elements by a global rule; the wrapper owns it now (ADR 0053).
const TEXT_CLASSES =
  'box-border min-h-[var(--control-height)] w-full rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)]';
// A colour swatch is a small square, not a field.
const COLOR_CLASSES =
  'size-[2.35rem] rounded-[0.35rem] border border-[var(--border)] bg-[var(--surface)] p-[0.2rem] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)]';
const MONO_CLASSES = "font-['IBM_Plex_Mono',ui-monospace,monospace]";

type Props = Omit<ComponentPropsWithRef<'input'>, 'aria-label' | 'id' | 'value' | 'defaultValue' | 'onChange' | 'type' | 'title'> &
  ControlNaming & {
    value: string;
    onChange: (value: string) => void;
    // `color` is the browser's colour picker; no other input type is offered, so a page cannot ask for a native one.
    type?: 'text' | 'color';
    // The typeface for values that are code: a hex colour, an id.
    mono?: boolean;
  };

// A bare text input: the control alone, full width of its container, controlled, and `onChange` reports the text, not the
// event. Use `Field` when the control has a visible label, a hint or an error. It passes standard input attributes and the
// ref through (`placeholder`, `disabled`, `onKeyDown`, and the `role` and `aria-*` of the alias combobox), so a widget can build
// on it.
export function TextField({ label, value, onChange, type = 'text', mono = false, className = '', ...rest }: Props) {
  return (
    <Input
      {...rest}
      type={type}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${type === 'color' ? COLOR_CLASSES : TEXT_CLASSES} ${mono ? MONO_CLASSES : ''} ${className}`}
    />
  );
}
