import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'ghost' | 'danger';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-strong)]',
  ghost: 'border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--surface-2)]',
  danger: 'border-[var(--danger)] bg-transparent text-[var(--danger-text)] hover:bg-[var(--review-soft)]',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center gap-1.5 rounded-md border px-4 py-2 font-['Barlow_Condensed',sans-serif] font-semibold tracking-[0.03em] uppercase transition disabled:pointer-events-none disabled:opacity-40 [:where(&)]:text-[0.85rem] ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
