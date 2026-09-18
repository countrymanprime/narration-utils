import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-strong)]',
  ghost: 'border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--surface-2)]',
  danger: 'border-[var(--danger)] bg-transparent text-[var(--danger)] hover:bg-[var(--review-soft)]',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center gap-1.5 rounded-md border px-4 py-2 font-['Barlow_Condensed',sans-serif] text-[0.85rem] font-semibold uppercase tracking-[0.03em] transition disabled:pointer-events-none disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
