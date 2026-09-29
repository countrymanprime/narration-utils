import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { useId } from 'react';
import type { MouseEvent, ReactNode } from 'react';

export type ContextMenuItem = {
  key: string;
  label: string;
  // Why the item is off, shown under the label and read as its description. An item with a reason is disabled.
  unavailable?: string;
  onSelect: () => void;
};

// An area that opens a menu of actions at the pointer on a right click, a long press, or the keyboard's Menu key or
// Shift+F10 (edit-and-proof-workspace.prd.md Phase 9, ADR 0705). It is `Menu`'s sibling: the same popup, the same items,
// the same roles and keys, but opened by the area instead of a button. `onOpen` runs on the contextmenu event, before the
// menu opens, so the caller can choose what the menu acts on (the word under the pointer) and the items reflect it. A menu
// with no items leaves the browser's own menu alone. An item that cannot run says why instead of vanishing, and is not
// selectable. The area keeps its own layout (`className`); the popup sits between the slide-over and the dialogs.
export function ContextMenu({
  items,
  onOpen,
  className,
  children,
}: {
  items: ContextMenuItem[];
  onOpen?: (event: MouseEvent) => void;
  className?: string;
  children: ReactNode;
}) {
  const reasonId = useId();
  return (
    <BaseContextMenu.Root>
      <BaseContextMenu.Trigger className={className} onContextMenu={items.length > 0 || onOpen ? onOpen : undefined}>
        {children}
      </BaseContextMenu.Trigger>
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner collisionPadding={8} className="z-[55]">
          <BaseContextMenu.Popup className="w-64 rounded-[0.4rem] border border-[var(--border)] bg-[var(--surface)] p-[0.35rem] shadow-[var(--shadow-lg)] outline-none">
            {items.map((item) => (
              <BaseContextMenu.Item
                key={item.key}
                disabled={item.unavailable !== undefined}
                aria-describedby={item.unavailable === undefined ? undefined : `${reasonId}-${item.key}`}
                onClick={item.onSelect}
                className="flex w-full cursor-pointer flex-col gap-0.5 rounded-[0.3rem] px-[0.55rem] py-[0.45rem] text-left text-[0.82rem] outline-none data-[disabled]:cursor-default data-[disabled]:text-[var(--text-muted)] data-[highlighted]:bg-[var(--surface-2)]"
              >
                {item.label}
                {item.unavailable !== undefined && (
                  <span id={`${reasonId}-${item.key}`} className="text-[0.72rem] text-[var(--text-muted)]">
                    {item.unavailable}
                  </span>
                )}
              </BaseContextMenu.Item>
            ))}
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}
