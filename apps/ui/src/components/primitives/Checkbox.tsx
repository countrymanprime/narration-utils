import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';

// A labelled checkbox row: the box, then the label content, and pressing the label toggles it. Base UI's Checkbox is a
// styled `role="checkbox"` with a hidden native input for forms; the box below is drawn with the app's tokens, not the
// browser's default control (ADR 0047). Controlled: it never holds its own state.
export function Checkbox({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex items-start gap-2 py-0.5 text-sm">
      <BaseCheckbox.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-[0.2rem] inline-flex size-4 flex-none items-center justify-center rounded-[0.25rem] border border-[var(--border)] bg-[var(--surface)] text-[var(--accent-contrast)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] data-[checked]:border-[var(--accent)] data-[checked]:bg-[var(--accent)] data-[disabled]:opacity-40"
      >
        <BaseCheckbox.Indicator className="inline-flex text-[0.6rem]">
          <FontAwesomeIcon icon={faCheck} />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      <span>{children}</span>
    </label>
  );
}
