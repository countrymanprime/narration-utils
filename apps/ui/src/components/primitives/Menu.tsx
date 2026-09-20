import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { CSSProperties, ReactNode } from 'react';

export type MenuItem = {
  key: string;
  label: string;
  // Drawn before the label (a colour dot, an icon).
  leading?: ReactNode;
  onSelect: () => void;
};

// A menu button: the trigger (its content is `children`) opens a menu of items. Base UI supplies what the hand-rolled
// `role="menu"` lacked: arrow keys, Home and End, typeahead, Enter and Space, Escape, `aria-haspopup`/`aria-expanded`, and
// focus returning to the button. Choosing an item calls its `onSelect` and closes the menu. The trigger keeps the caller's
// look (`triggerClassName`, `triggerStyle`); the popup sits between the slide-over and the dialogs.
export function Menu({
  items,
  disabled,
  triggerClassName,
  triggerStyle,
  children,
}: {
  items: MenuItem[];
  disabled?: boolean;
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  children: ReactNode;
}) {
  return (
    // Not modal: the page behind stays scrollable and clickable, as with the menu this replaced (a press outside closes it).
    <BaseMenu.Root modal={false}>
      <BaseMenu.Trigger disabled={disabled} className={triggerClassName} style={triggerStyle}>
        {children}
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className="z-[55]">
          <BaseMenu.Popup className="w-44 rounded-[0.4rem] border border-[var(--border)] bg-[var(--surface)] p-[0.35rem] shadow-[var(--shadow-lg)] outline-none">
            {items.map((item) => (
              <BaseMenu.Item
                key={item.key}
                onClick={item.onSelect}
                className="flex w-full cursor-pointer items-center gap-2 rounded-[0.3rem] px-[0.55rem] py-[0.45rem] text-left text-[0.82rem] outline-none data-[highlighted]:bg-[var(--surface-2)]"
              >
                {item.leading}
                {item.label}
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
