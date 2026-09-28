import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faCircleCheck, faCircleMinus, faCircleXmark, faEarListen, faLock, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { DeliveryRuleStatus, DeliveryVerification } from '../../types';
import { StatusBadge, toneColors, type StatusTone, type BadgeLook } from '../primitives/StatusBadge';

// The small status marks of Master & QC (docs/prds/delivery-platform-profiles.prd.md, mockups 01 to 04): a rule's result,
// how its requirement was verified, and the profile's counts. The words carry the meaning; the colour and icon repeat it.
// `Mark` draws through StatusBadge, the one badge primitive (mock-fidelity-primitives-and-components.prd.md Phase 14, ADR
// 0600): a tone that was already a fill (`ok`, `danger`, `info`) stays soft; one that was outline-only (`warn`, `muted`)
// keeps that look, so DeliveryProfilesPanel's "Built in"/"Custom" tags and DeliveryProfileEditor's marks are unchanged.

type Tone = 'ok' | 'danger' | 'info' | 'warn' | 'muted';

const STATUS_TONE: Record<Tone, StatusTone> = {
  ok: 'success',
  danger: 'danger',
  info: 'info',
  warn: 'warning',
  muted: 'neutral',
};

const LOOK: Record<Tone, BadgeLook> = {
  ok: 'soft',
  danger: 'soft',
  info: 'soft',
  warn: 'outline',
  muted: 'outline',
};

export function Mark({ tone, icon, children }: { tone: Tone; icon?: IconDefinition; children: string }) {
  return <StatusBadge tone={STATUS_TONE[tone]} look={LOOK[tone]} shape="pill" label={children} icon={icon && <FontAwesomeIcon icon={icon} />} />;
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

// 16 px, the mocks' round checklist icon (mock-fidelity-primitives-and-components.prd.md Phase 14, mock 05).
/** How a value stands in a table cell: an icon in the result's colour, beside the value in words. */
export function ResultIcon({ status }: { status: DeliveryRuleStatus }) {
  const { tone, icon } = RESULT[status];
  return <FontAwesomeIcon icon={icon} aria-hidden="true" className="mr-1.5 size-4 flex-none" style={{ color: toneColors(STATUS_TONE[tone]).text }} />;
}

export const LISTEN_ICON = faEarListen;
export const LOCK_ICON = faLock;
