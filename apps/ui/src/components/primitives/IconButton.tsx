import type { ComponentPropsWithRef } from 'react';

type IconButtonVariant = 'default' | 'primary' | 'danger';

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  default: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
  primary: 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-strong)]',
  danger: 'border-[var(--danger)] bg-[var(--surface)] text-[var(--danger-text)] hover:bg-[var(--review-soft)]',
};

type Props = Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'title'> & {
  // The accessible name. An icon has no text, so it is required: it is what a screen reader says and what a hint repeats.
  label: string;
  variant?: IconButtonVariant;
};

// A square 32 px button that holds one icon. Its look was a class string pasted at every call site; this is the one place
// it lives (ADR 0053). A hint is composed around it, `<TooltipTarget text="..."><IconButton .../></TooltipTarget>`, because
// the hint often says more than the label and the wrapper sometimes needs its own layout class. A disabled one is dimmed and
// takes no hover, like `Button`. It also renders as the button of a Base UI part (`render={<IconButton .../>}`), so it
// forwards every attribute and the ref.
export function IconButton({ label, variant = 'default', className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      aria-label={label}
      // `display` has no specificity here, so a caller can hide it (`hidden max-md:inline-flex`) without a class fight.
      className={`size-8 items-center justify-center rounded-md border disabled:pointer-events-none disabled:opacity-40 [:where(&)]:inline-flex ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
