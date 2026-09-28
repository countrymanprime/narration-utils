import type { ComponentPropsWithRef } from 'react';
import type { ControlNaming } from './controlNaming';

type SelectOption = { value: string; label: string };

type Props = Omit<ComponentPropsWithRef<'select'>, 'aria-label' | 'id' | 'value' | 'defaultValue' | 'onChange' | 'children' | 'title'> &
  ControlNaming & {
    value: string;
    onChange: (value: string) => void;
    options: readonly SelectOption[];
    // Fill the container's width (a form column); by default the select is as wide as its longest option.
    fullWidth?: boolean;
  };

// The browser's own `<select>` element, drawn with the app's tokens (ADR 0053). It stays native on purpose: the platform's
// picker, keyboard search and form behaviour are the accessibility, `fireEvent.change` and Playwright's `selectOption` keep
// working, and no option needs rich content. Controlled, and `onChange` reports the chosen value, not the event.
export function Select({ label, value, onChange, options, fullWidth = false, className = '', ...rest }: Props) {
  return (
    <select
      {...rest}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      // A fixed height, not a minimum: a native <select> doesn't resolve `leading-[1.35]` the way an <input> or a styled
      // div does (mock-fidelity-primitives-and-components.prd.md Phase 6), so pinning the height is what makes it match
      // TextField's 40.8px instead of drifting a little taller.
      className={`box-border h-[var(--control-height)] rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
