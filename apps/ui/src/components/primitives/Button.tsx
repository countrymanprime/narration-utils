import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleNotch } from '@fortawesome/free-solid-svg-icons';
import type { ComponentProps } from 'react';

// `secondary` is the mocks' outlined button, filled `--surface` so it reads the same on the page background and in a card.
// `ghost` is the same button with no fill, for the rare one on a tinted surface. `link` is the underlined text action that sits
// inside a sentence: it takes the sentence's font, size and colour and draws none of the button chrome (ADR 0595).
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
// `md` is the mocks' 32 px button (`--button-height`); `sm` is 28 px (`--button-height-sm`), for the companion and dense rows.
type ButtonSize = 'md' | 'sm';

const VARIANT_CLASSES: Record<Exclude<ButtonVariant, 'link'>, string> = {
  primary: 'border-transparent bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-strong)]',
  secondary: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)]',
  ghost: 'border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--surface-2)]',
  danger: 'border-[var(--danger)] bg-transparent text-[var(--danger-text)] hover:bg-[var(--review-soft)]',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'min-h-[var(--button-height)]',
  sm: 'min-h-[var(--button-height-sm)]',
};

// The measured spec (mock-fidelity PRD, Phase 1): the height includes the 1 px border, 12 px each side, the label Barlow Condensed
// at `--font-size-sm`, 600, uppercase, tracked `--tracking-button`, on one line (`leading-none`, centred by the flex box). A label
// that wraps grows the button rather than spilling out of it. Disabled is drawn at 55%.
const CHROME =
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-button)] border px-3 py-1 font-['Barlow_Condensed',sans-serif] text-[length:var(--font-size-sm)] leading-none font-semibold tracking-[var(--tracking-button)] uppercase transition disabled:pointer-events-none disabled:opacity-55 aria-busy:pointer-events-none aria-busy:opacity-60";
const LINK = 'inline cursor-pointer underline disabled:pointer-events-none disabled:opacity-55 aria-busy:pointer-events-none aria-busy:opacity-60';

function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return variant === 'link' ? LINK : `${CHROME} ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]}`;
}

// `ComponentProps` carries `ref` (React 19 passes it as a prop), for the caller that has to put focus back on a button it disabled.
type Props = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  // Ignored by `link`, which is as tall as the text it sits in.
  size?: ButtonSize;
  // The action this button started is running (ADR 0075). The button says so (`aria-busy`, a spinner, dimmed) and ignores a press, but
  // stays focusable, so a keyboard user does not lose their place the way they do when a button becomes `disabled`.
  pending?: boolean;
};

// The look lives here and nowhere else: a caller's `className` is for layout (margin, width, flex, visibility), never for padding,
// type or height. `src/buttonOverrides.test.ts` holds that line.
export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', pending = false, onClick, children, ...rest }: Props) {
  return (
    <button
      type={type}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      // A press does nothing while pending, and it does not submit a form either (`preventDefault` stops the native submit).
      onClick={pending ? (event) => event.preventDefault() : onClick}
      className={`${buttonClasses(variant, size)} ${className}`}
      {...rest}
    >
      {pending && <FontAwesomeIcon icon={faCircleNotch} className="motion-safe:animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
