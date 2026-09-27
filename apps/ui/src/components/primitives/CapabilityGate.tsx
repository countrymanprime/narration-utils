import { cloneElement, useId, type MouseEvent, type ReactElement } from 'react';
import { StatusBadge } from './StatusBadge';
import { TooltipTarget } from './Tooltip';

// The shape of one entry of the DAW port's `DawCapabilities` payload, copied locally so this primitive imports
// nothing from src/api (ADR 0360): only phase 12's `useCapability` knows the wire, and this gate takes whatever
// plain entry a caller hands it.
type CapabilityLevel = 'unsupported' | 'not_yet_available' | 'experimental' | 'supported';

export type CapabilityEntry = {
  level: CapabilityLevel;
  available: boolean;
  message?: string;
};

// The one control this wraps. Typed loosely (`any` props) on purpose: the gate composes with whatever interactive
// element a caller passes - `Button`, `IconButton`, a `NavButton` - not one closed shape, the same way `TooltipTarget`
// reads a child's `disabled` prop through a cast rather than a generic type parameter.
type GatedControl = ReactElement;

function controlName(control: GatedControl): string {
  const props = control.props as { label?: unknown; 'aria-label'?: unknown; children?: unknown };
  if (typeof props.label === 'string') return props.label;
  if (typeof props['aria-label'] === 'string') return props['aria-label'];
  if (typeof props.children === 'string') return props.children;
  return '';
}

const swallow = (event: MouseEvent) => event.preventDefault();

export function CapabilityGate({
  capability,
  // Q3's opt-out: a caller may hide an `unsupported` control instead of showing it disabled with the host's message.
  // A `not_yet_available` or an unavailable `experimental`/`supported` control is never hidden by this flag - the
  // narrator still learns the control exists and why it is off.
  hideWhenUnsupported = false,
  children,
}: {
  capability: CapabilityEntry;
  hideWhenUnsupported?: boolean;
  children: GatedControl;
}) {
  const descriptionId = useId();

  if (capability.available) {
    if (capability.level !== 'experimental') return children;
    if (!capability.message) {
      return (
        <span className="inline-flex items-center gap-[0.4rem]">
          {children}
          <StatusBadge tone="experimental" label="Experimental" />
        </span>
      );
    }
    const described = cloneElement(children, { 'aria-describedby': descriptionId } as never);
    return (
      <span className="inline-flex items-center gap-[0.4rem]">
        {described}
        <StatusBadge tone="experimental" label="Experimental" />
        <span id={descriptionId} className="sr-only">
          {capability.message}
        </span>
      </span>
    );
  }

  if (capability.level === 'unsupported' && hideWhenUnsupported) return null;

  const message = capability.message || controlName(children);
  const gated = cloneElement(children, {
    'aria-disabled': true,
    'aria-describedby': descriptionId,
    onClick: swallow,
  } as never);

  return (
    <>
      <TooltipTarget text={message}>{gated}</TooltipTarget>
      <span id={descriptionId} className="sr-only">
        {message}
      </span>
    </>
  );
}
