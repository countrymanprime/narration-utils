import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { createContext, useContext, type ReactNode } from 'react';

type TabsVariant = 'underline' | 'sidebar';

const VariantContext = createContext<TabsVariant>('underline');

// A strip of underlined labels (the Story Bible categories, Settings' scope), or a list of side labels (Settings' categories).
// The classes are mutually exclusive by state (ADR 0017) and take the selected look from Base UI's `data-active`.
const TAB_CLASSES: Record<TabsVariant, string> = {
  underline:
    "border-b-2 border-transparent px-[0.9rem] py-2 font-['Barlow_Condensed',sans-serif] text-[0.85rem] font-semibold tracking-[0.03em] whitespace-nowrap text-[var(--text-muted)] uppercase hover:text-[var(--text)] focus-visible:-outline-offset-2 data-[active]:border-[var(--accent)] data-[active]:text-[var(--text)]",
  sidebar:
    "relative flex items-center gap-[0.6rem] rounded-[0.4rem] border-0 px-[0.8rem] py-[0.55rem] text-left font-['Barlow_Condensed',sans-serif] text-base font-semibold tracking-[0.03em] whitespace-nowrap text-[var(--text-muted)] uppercase hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:-outline-offset-2 data-[active]:bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] data-[active]:text-[var(--accent-strong)] md:w-full md:whitespace-normal",
};
const LIST_CLASSES: Record<TabsVariant, string> = {
  underline: 'flex gap-1 overflow-x-auto border-b border-[var(--border)]',
  sidebar: '',
};

// Tabs in four parts, because the strip and the panel it controls sit in different places of a page: `Tabs` is the root
// (controlled: `value`, `onChange`; `className` is its layout, and `contents` lets its children join the parent's grid),
// `TabList` the strip, `Tab` one label, `TabPanel` the content of the selected tab. Base UI makes the strip a `tablist`
// and its labels `tab`s with `aria-selected`, links each to its panel (`aria-controls`, `aria-labelledby`), and moves
// between them with the arrow keys, Home and End (the arrows of the strip's `orientation`).
export function Tabs({
  value,
  onChange,
  orientation = 'horizontal',
  className,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseTabs.Root value={value} onValueChange={(next) => onChange(String(next))} orientation={orientation} className={className}>
      {children}
    </BaseTabs.Root>
  );
}

// `label` names the strip. Arrow keys only move focus by default and Enter or Space select, which suits a choice that asks
// a question (Settings' scope offers to discard edits); `activation="automatic"` selects as focus moves, which suits a filter
// that only redraws a list (the Story Bible categories). `className` adds layout to the strip.
export function TabList({
  label,
  variant = 'underline',
  activation = 'manual',
  className = '',
  children,
}: {
  label: string;
  variant?: TabsVariant;
  activation?: 'manual' | 'automatic';
  className?: string;
  children: ReactNode;
}) {
  return (
    <VariantContext.Provider value={variant}>
      <BaseTabs.List aria-label={label} activateOnFocus={activation === 'automatic'} className={`${LIST_CLASSES[variant]} ${className}`}>
        {children}
      </BaseTabs.List>
    </VariantContext.Provider>
  );
}

export function Tab({ value, children }: { value: string; children: ReactNode }) {
  const variant = useContext(VariantContext);
  return (
    <BaseTabs.Tab value={value} className={TAB_CLASSES[variant]}>
      {children}
    </BaseTabs.Tab>
  );
}

// The content of the selected tab. It takes no tab stop of its own (Base UI would give it one): the controls inside it are
// reached by Tab after the strip.
export function TabPanel({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  return (
    <BaseTabs.Panel value={value} tabIndex={-1} className={className}>
      {children}
    </BaseTabs.Panel>
  );
}
