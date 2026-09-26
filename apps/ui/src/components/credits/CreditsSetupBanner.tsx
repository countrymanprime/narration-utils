import { useState } from 'react';
import { apiErrorMessage } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import type { CreditsSetupState } from '../../types';
import { Button } from '../primitives/Button';
import type { Notify } from '../primitives/Toast';

/**
 * The credits-setup banner (credits-token-setup-and-front-matter-detection.prd.md, Phase 3, CS1 C): the way back to
 * the "Set up the credits" dialog once the narrator has pressed Not now, or after Save leaves some tokens still
 * unresolved. Shown on Home and above the Manuscript credits card
 * (mockups/credits-token-setup-and-front-matter-detection/02-home-banner-after-not-now.webp,
 * 03-manuscript-banner-and-fill-in.webp) whenever `CreditsSetupState.banner` is true - which the host already limits
 * to "tokens are unresolved and the narrator has not said Don't ask" (CS2).
 */
export function CreditsSetupBanner({
  state,
  onDone,
  onFillIn,
  notify,
}: {
  state: CreditsSetupState;
  onDone: (next: CreditsSetupState) => void;
  onFillIn: () => void;
  notify: Notify;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const tokens = state.fields.map((field) => field.token);
  const dontAsk = async () => {
    setBusy(true);
    try {
      onDone(await api.creditsSetupDismiss('project'));
    } catch (error) {
      notify(apiErrorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-[1.1rem] shadow-[var(--shadow)]"
      style={{ borderColor: 'var(--review)', background: 'var(--surface)' }}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="size-2 flex-none rounded-full" style={{ background: 'var(--review)' }} />
        <span>
          <strong>
            The credits need {tokens.length} value{tokens.length === 1 ? '' : 's'}
          </strong>{' '}
          — {tokens.join(', ')} will be read as written, in brackets.
        </span>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" type="button" disabled={busy} onClick={() => void dontAsk()}>
          Don&rsquo;t ask for this project
        </Button>
        <Button variant="primary" type="button" disabled={busy} onClick={onFillIn}>
          Fill in
        </Button>
      </div>
    </section>
  );
}
