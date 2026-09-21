import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleNotch } from '@fortawesome/free-solid-svg-icons';
import type { ComponentProps } from 'react';

type ButtonVariant = 'primary' | 'ghost' | 'danger';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-strong)]',
  ghost: 'border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--surface-2)]',
  danger: 'border-[var(--danger)] bg-transparent text-[var(--danger-text)] hover:bg-[var(--review-soft)]',
};

// `ComponentProps` carries `ref` (React 19 passes it as a prop), for the caller that has to put focus back on a button it disabled.
type Props = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  // The action this button started is running (ADR 0075). The button says so (`aria-busy`, a spinner, dimmed) and ignores a press, but
  // stays focusable, so a keyboard user does not lose their place the way they do when a button becomes `disabled`.
  pending?: boolean;
};

export function Button({ variant = 'primary', className = '', type = 'button', pending = false, onClick, children, ...rest }: Props) {
  return (
    <button
      type={type}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      // A press does nothing while pending, and it does not submit a form either (`preventDefault` stops the native submit).
      onClick={pending ? (event) => event.preventDefault() : onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-4 py-2 font-['Barlow_Condensed',sans-serif] font-semibold tracking-[0.03em] uppercase transition disabled:pointer-events-none disabled:opacity-40 aria-busy:pointer-events-none aria-busy:opacity-60 [:where(&)]:text-[0.85rem] ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {pending && <FontAwesomeIcon icon={faCircleNotch} className="motion-safe:animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
