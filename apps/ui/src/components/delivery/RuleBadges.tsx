import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faCircleCheck, faCircleMinus, faCircleXmark, faEarListen, faLock, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { DeliveryRuleStatus, DeliveryVerification } from '../../types';

// The small status marks of the Delivery page (docs/prds/delivery-platform-profiles.prd.md, mockups 01 to 04): a rule's result,
// how its requirement was verified, and the profile's counts. The words carry the meaning; the colour and icon repeat it.

type Tone = 'ok' | 'danger' | 'info' | 'warn' | 'muted';

const TONE: Record<Tone, { color: string; border: string; background: string }> = {
  ok: { color: 'var(--ok-text)', border: 'var(--ok)', background: 'color-mix(in srgb, var(--ok) 12%, transparent)' },
  danger: { color: 'var(--danger-text)', border: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)' },
  info: { color: 'var(--info-text)', border: 'var(--info)', background: 'color-mix(in srgb, var(--info) 12%, transparent)' },
  warn: { color: 'var(--warn-text)', border: 'var(--warn)', background: 'transparent' },
  muted: { color: 'var(--text-muted)', border: 'var(--border)', background: 'transparent' },
};

export function Mark({ tone, icon, children }: { tone: Tone; icon?: IconDefinition; children: string }) {
  const { color, border, background } = TONE[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-['Barlow_Condensed',sans-serif] text-[0.72rem] leading-tight font-semibold tracking-[0.03em] whitespace-nowrap uppercase"
      style={{ color, borderColor: border, background }}
    >
      {icon && <FontAwesomeIcon icon={icon} aria-hidden="true" className="size-3" />}
      {children}
    </span>
  );
}

const RESULT: Record<DeliveryRuleStatus, { tone: Tone; icon: IconDefinition; label: string }> = {
  met: { tone: 'ok', icon: faCircleCheck, label: 'Met' },
  not_met: { tone: 'danger', icon: faCircleXmark, label: 'Not met' },
  not_checked: { tone: 'info', icon: faCircleMinus, label: 'Not checked by the app' },
  not_measurable: { tone: 'muted', icon: faCircleMinus, label: 'Not measurable' },
  off: { tone: 'muted', icon: faCircleMinus, label: 'Off' },
};

export function ResultMark({ status }: { status: DeliveryRuleStatus }) {
  const { tone, icon, label } = RESULT[status];
  return (
    <Mark tone={tone} icon={icon}>
      {label}
    </Mark>
  );
}

export function VerificationMark({ verification }: { verification: DeliveryVerification }) {
  if (verification === 'verified') return <Mark tone="muted">Verified</Mark>;
  return (
    <Mark tone="warn" icon={faTriangleExclamation}>
      {verification === 'conflicting' ? 'Conflicting sources' : 'To verify'}
    </Mark>
  );
}

/** How a value stands in a table cell: an icon in the result's colour, beside the value in words. */
export function ResultIcon({ status }: { status: DeliveryRuleStatus }) {
  const { tone, icon } = RESULT[status];
  return <FontAwesomeIcon icon={icon} aria-hidden="true" className="mr-1.5 size-3.5 flex-none" style={{ color: TONE[tone].color }} />;
}

export const LISTEN_ICON = faEarListen;
export const LOCK_ICON = faLock;
