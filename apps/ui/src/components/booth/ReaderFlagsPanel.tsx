import { useId, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { CapabilityGate } from '../primitives/CapabilityGate';
import { Checkbox } from '../primitives/Checkbox';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { formatTime } from '../proof/findingFormat';
import { useCapability } from '../../useCapability';
import { FLAG_KINDS, FLAG_NAMES, type FlagVisibility } from './readerFlags';
import type { TeleprompterFlag, TeleprompterFlagKind, TeleprompterPunchResult } from '../../types';

const SECTION_LABEL = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";
const LIST_BUTTON =
  'flex w-full flex-col items-start gap-0.5 rounded-[0.35rem] border border-transparent px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none aria-[current=true]:border-[var(--accent)] aria-[current=true]:bg-[var(--surface-2)]';

const SHOW_LABELS: Record<TeleprompterFlagKind, string> = {
  skipped: 'Skipped words',
  restart: 'Restarts',
  misread: 'Misreads',
  extra: 'Extra words',
};

/**
 * Where keeping the session's flags as findings stands (ADR 0117); shown so a failed save is never silent.
 * `not-kept` is the credits mode of the read-aloud dialog (manuscript-credits-card-parity.prd.md, Phase 2, MC8 a):
 * credits carry no chapter id to keep a finding against, so their flags are shown during the session and never saved.
 */
export type FlagSaveState =
  { status: 'idle' } | { status: 'saving' } | { status: 'saved'; count: number } | { status: 'error'; message: string } | { status: 'not-kept' };

type Props = {
  /** Every flag of the session, in arrival order. */
  flags: TeleprompterFlag[];
  visibility: FlagVisibility;
  onVisibility: (kind: TeleprompterFlagKind, shown: boolean) => void;
  dismissed: ReadonlySet<number>;
  onDismiss: (flag: TeleprompterFlag) => void;
  selected?: TeleprompterFlag;
  onSelect: (flag: TeleprompterFlag) => void;
  /** The script words a flag is about (`flagText`). */
  textOf: (flag: TeleprompterFlag) => string;
  save: FlagSaveState;
};

function quoted(text: string): string {
  return text ? `“${text}”` : 'nothing';
}

/**
 * Punch and roll's confirm step (teleprompter-manuscript-integration.prd.md Phase 12, "UI showing resolved time, its
 * source... and pre-roll before moving"): a preview is fetched before the dialog opens, so nothing in REAPER moves
 * until the narrator presses Punch.
 */
type PunchState =
  | { phase: 'idle' }
  | { phase: 'previewing' }
  | { phase: 'confirm'; preview: TeleprompterPunchResult; pending: boolean; error?: string }
  | { phase: 'refused'; message: string };

const PUNCH_SOURCE_LABEL: Record<NonNullable<TeleprompterPunchResult['source']>, string> = {
  anchor: 'Timed from your reading just now.',
  alignment: 'Timed by finding the word in your recording.',
  estimate: 'Estimated from your reading pace (the word could not be found in the recording).',
};

function PunchConfirmDialog({ state, onConfirm, onCancel }: { state: PunchState & { phase: 'confirm' }; onConfirm: () => void; onCancel: () => void }) {
  const { preview, pending, error } = state;
  return (
    <ConfirmDialog
      title="Punch from here"
      confirmLabel="Punch"
      confirm={onConfirm}
      cancel={onCancel}
      pending={pending}
      escapeCancels={!pending}
      body={
        <>
          <p>
            Moves REAPER's edit cursor to <strong>{formatTime(preview.resolvedTime ?? 0)}</strong>
            {typeof preview.preRoll === 'number' && preview.preRoll > 0 ? (
              <>
                {' '}
                ({preview.preRoll}s pre-roll, so it lands at <strong>{formatTime(Math.max(0, (preview.resolvedTime ?? 0) - preview.preRoll))}</strong>)
              </>
            ) : null}
            . Nothing else changes.
          </p>
          <p style={{ color: 'var(--text-muted)' }}>{preview.source ? PUNCH_SOURCE_LABEL[preview.source] : null}</p>
        </>
      }
    >
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}

function SaveStatus({ save }: { save: FlagSaveState }) {
  const text =
    save.status === 'saving'
      ? 'Keeping the flags for review…'
      : save.status === 'saved'
        ? `${save.count === 1 ? '1 flag is' : `${save.count} flags are`} kept for review as suspected, unreviewed findings.`
        : save.status === 'error'
          ? `The flags could not be kept for review: ${save.message}`
          : save.status === 'not-kept'
            ? 'Flags on the credits are not kept.'
            : 'When reading stops, the flags are kept for review as suspected, unreviewed findings.';
  return (
    <p role="status" className="text-xs" style={{ color: save.status === 'error' ? 'var(--danger-text)' : 'var(--text-muted)' }}>
      {text}
    </p>
  );
}

/**
 * The read-aloud rail's Flags tab (teleprompter-manuscript-integration.prd.md Phase 7): which kinds of suspected flag show in
 * the text, the one a mark opened (what the script says, what was heard, Dismiss, and "Punch from here" waiting on Phase 12),
 * and the session's flags as a list. Selecting one never moves the reading position or scrolls the text.
 */
export function ReaderFlagsPanel({ flags, visibility, onVisibility, dismissed, onDismiss, selected, onSelect, textOf, save }: Props) {
  const headingId = useId();
  const api = useApi();
  // Punch and roll moves the REAPER edit cursor to a flag (teleprompter-manuscript-integration.prd.md Phase 12): the
  // DAW port's own capability entry explains why the button is off when `punch` is not available (DAW port PRD Phase
  // 7, ADR 0360); once it is, the click resolves the flagged word's time (a preview, nothing moves yet) before
  // confirming.
  const punchCapability = useCapability('punch');
  const [punch, setPunch] = useState<PunchState>({ phase: 'idle' });
  const startPunch = async (flag: TeleprompterFlag) => {
    setPunch({ phase: 'previewing' });
    try {
      const preview = await api.teleprompterPunchPreview(flag.start);
      if (preview.outcome === 'refused') setPunch({ phase: 'refused', message: preview.message ?? 'Punch from here could not be resolved.' });
      else setPunch({ phase: 'confirm', preview, pending: false });
    } catch (reason: unknown) {
      setPunch({ phase: 'refused', message: String(reason) });
    }
  };
  const confirmPunch = async (flag: TeleprompterFlag) => {
    if (punch.phase !== 'confirm') return;
    setPunch({ ...punch, pending: true, error: undefined });
    try {
      const result = await api.teleprompterPunch(flag.start);
      if (result.outcome === 'refused')
        setPunch({ phase: 'confirm', preview: punch.preview, pending: false, error: result.message ?? 'Punch from here failed.' });
      else setPunch({ phase: 'idle' });
    } catch (reason: unknown) {
      setPunch({ phase: 'confirm', preview: punch.preview, pending: false, error: String(reason) });
    }
  };
  const shown = flags.filter((flag) => visibility[flag.kind]);
  const hidden = flags.length - shown.length;
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Suspected by live listening, which can mishear a correct read. Transcript Compare over the recording is authoritative.
      </p>
      <fieldset>
        <legend className={`mb-1 ${SECTION_LABEL}`}>Show in the text</legend>
        {FLAG_KINDS.map((kind) => (
          <Checkbox key={kind} checked={visibility[kind]} onChange={(checked) => onVisibility(kind, checked)}>
            {SHOW_LABELS[kind]}
          </Checkbox>
        ))}
      </fieldset>
      {selected && (
        <section aria-labelledby={headingId} className="rounded-[0.35rem] border border-[var(--border)] p-2.5">
          <h3 id={headingId} className="font-semibold">
            {FLAG_NAMES[selected.kind]}
          </h3>
          <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
            <dt style={{ color: 'var(--text-muted)' }}>{selected.kind === 'extra' ? 'Before' : 'Script'}</dt>
            <dd className="[overflow-wrap:anywhere]">{quoted(textOf(selected))}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Heard</dt>
            <dd className="[overflow-wrap:anywhere]">{quoted(selected.heard)}</dd>
          </dl>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {dismissed.has(selected.id) ? (
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Dismissed
              </span>
            ) : (
              <Button variant="ghost" onClick={() => onDismiss(selected)}>
                Dismiss
              </Button>
            )}
            <CapabilityGate capability={punchCapability}>
              <Button variant="ghost" pending={punch.phase === 'previewing'} onClick={() => startPunch(selected)}>
                Punch from here
              </Button>
            </CapabilityGate>
          </div>
          {punch.phase === 'refused' && (
            <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
              {punch.message}
            </p>
          )}
        </section>
      )}
      {punch.phase === 'confirm' && selected && (
        <PunchConfirmDialog state={punch} onConfirm={() => confirmPunch(selected)} onCancel={() => setPunch({ phase: 'idle' })} />
      )}
      <div>
        <div className={`mb-1.5 ${SECTION_LABEL}`}>This session</div>
        {shown.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {flags.length === 0 ? 'No flags yet.' : 'No flags of the kinds shown.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {shown.map((flag) => (
              <li key={flag.id}>
                <button type="button" className={LIST_BUTTON} aria-current={flag.id === selected?.id || undefined} onClick={() => onSelect(flag)}>
                  <span className="font-medium">
                    {FLAG_NAMES[flag.kind]}
                    {dismissed.has(flag.id) && <span style={{ color: 'var(--text-muted)' }}> (dismissed)</span>}
                  </span>
                  <span className="[overflow-wrap:anywhere]" style={{ color: 'var(--text-muted)' }}>
                    {quoted(textOf(flag))}
                    {flag.kind !== 'skipped' && `, heard ${quoted(flag.heard)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            {hidden === 1 ? '1 more flag is' : `${hidden} more flags are`} of a kind not shown.
          </p>
        )}
      </div>
      <SaveStatus save={save} />
    </div>
  );
}
