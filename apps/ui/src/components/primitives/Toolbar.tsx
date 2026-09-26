import { Toolbar as BaseToolbar } from '@base-ui/react/toolbar';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';

// Elements a roving-tabindex item can land on. A genuinely disabled one (native `disabled`) is never a Home/End target,
// the same items the arrow keys already skip: Base UI keeps a composite item focusable through `aria-disabled` instead
// of `disabled` whenever `focusableWhenDisabled` (the default) applies, so only an item taken out of the rotation on
// purpose (`focusableWhenDisabled={false}`) is excluded here.
function rovingItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]:not([aria-disabled="true"]), input:not(:disabled)'));
}

// One tab stop, arrow keys rove focus, on Base UI's toolbar part (WAI-ARIA APG toolbar pattern; `role="toolbar"`, the
// composite roving tabindex, disabled items that stay out of the rotation). The installed @base-ui/react 1.8 toolbar
// root does not move focus on Home/End on its own (`enableHomeAndEndKeys` is internal to its composite and the part
// exposes no prop for it), so this adds the one missing step: a keydown handler that puts native focus on the first or
// last item. Each item's own `onFocus` (Base UI's roving-tabindex bookkeeping) then re-syncs the highlighted index, so
// the two mechanisms never disagree about which item is current.
export function Toolbar({
  label,
  orientation = 'horizontal',
  className = '',
  children,
}: {
  label: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseToolbar.Root
      aria-label={label}
      orientation={orientation}
      className={`flex gap-1 ${orientation === 'vertical' ? 'flex-col' : 'items-center'} ${className}`}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Home' && event.key !== 'End') return;
        const items = rovingItems(event.currentTarget);
        if (items.length === 0) return;
        event.preventDefault();
        (event.key === 'Home' ? items[0] : items[items.length - 1]).focus();
      }}
    >
      {children}
    </BaseToolbar.Root>
  );
}

// One item of the toolbar. `render` composes it with the library's own control (`<Button>`, `<IconButton>`), the same
// pattern as `Menu`'s trigger: that element keeps its own look and accessible name, and this only adds the roving
// tabindex, `role="toolbar"` membership and the disabled/focusable wiring `CapabilityGate` needs later. `disabled`
// with `focusableWhenDisabled` false (default true) takes the item out of the rotation entirely, for a command a
// caller chooses to hide from the keyboard order rather than show as unavailable.
export function ToolbarButton({
  render,
  disabled = false,
  focusableWhenDisabled = true,
  children,
}: {
  render: ReactElement;
  disabled?: boolean;
  focusableWhenDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <BaseToolbar.Button render={render} disabled={disabled} focusableWhenDisabled={focusableWhenDisabled}>
      {children}
    </BaseToolbar.Button>
  );
}
