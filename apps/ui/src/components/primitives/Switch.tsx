import { Switch as BaseSwitch } from '@base-ui/react/switch';
import type { ReactNode } from 'react';

// An on/off setting: a track with a thumb, then its label, and pressing the label toggles it. It is a `role="switch"`
// (Base UI), which announces "on" and "off", the right semantics for a setting that takes effect at once, where a checkbox
// says "checked". The Settings `bool` kind is a row of it (ScopedSetting). Controlled.
export function Switch({
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
    <label className="inline-flex items-center gap-2 text-sm">
      <BaseSwitch.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="inline-flex h-5 w-9 flex-none items-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] data-[checked]:border-[var(--accent)] data-[checked]:bg-[var(--accent)] data-[disabled]:opacity-40"
      >
        <BaseSwitch.Thumb className="size-3.5 rounded-full bg-[var(--surface)] shadow-[var(--shadow)] transition-transform data-[checked]:translate-x-4" />
      </BaseSwitch.Root>
      <span>{children}</span>
    </label>
  );
}
