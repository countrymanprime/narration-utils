import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible';
import type { ReactNode } from 'react';
import { IconButton } from './IconButton';

// A disclosure in three parts, because the button and the panel it shows usually sit in different places of the same
// section: `Collapsible` is the section (controlled: `open`, `onOpenChange`), `CollapsibleTrigger` the button, an `IconButton` (its label
// says what pressing it does, so it changes with the state) and `CollapsiblePanel` the content, which is not in the page
// while collapsed. Base UI supplies `aria-expanded` and links the button to the panel with `aria-controls`.
export function Collapsible({
  open,
  onOpenChange,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseCollapsible.Root open={open} onOpenChange={onOpenChange} className={className} render={<section />}>
      {children}
    </BaseCollapsible.Root>
  );
}

export function CollapsibleTrigger({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <BaseCollapsible.Trigger render={<IconButton label={label} className={className} />}>{children}</BaseCollapsible.Trigger>;
}

export function CollapsiblePanel({ className, children }: { className?: string; children: ReactNode }) {
  return <BaseCollapsible.Panel className={className}>{children}</BaseCollapsible.Panel>;
}
