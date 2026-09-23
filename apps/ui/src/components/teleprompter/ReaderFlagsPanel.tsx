import { useId } from 'react';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { TooltipTarget } from '../primitives/Tooltip';
import { FLAG_KINDS, FLAG_NAMES, type FlagVisibility } from './readerFlags';
import type { TeleprompterFlag, TeleprompterFlagKind } from '../../types';

const SECTION_LABEL = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";
const LIST_BUTTON =
  'flex w-full flex-col items-start gap-0.5 rounded-[0.35rem] border border-transparent px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none aria-[current=true]:border-[var(--accent)] aria-[current=true]:bg-[var(--surface-2)]';

const SHOW_LABELS: Record<TeleprompterFlagKind, string> = {
  skipped: 'Skipped words',
  restart: 'Restarts',
  misread: 'Misreads',
  extra: 'Extra words',
};

// Punch and roll moves the REAPER edit cursor to a flag (Phase 12); until then the action is shown, disabled, with the reason.
const PUNCH_PENDING = 'Punch and roll needs REAPER support that is not built yet.';

/** Where keeping the session's flags as findings stands (ADR 0117); shown so a failed save is never silent. */
export type FlagSaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved'; count: number } | { status: 'error'; message: string };

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

function SaveStatus({ save }: { save: FlagSaveState }) {
  const text =
    save.status === 'saving'
      ? 'Keeping the flags for review…'
      : save.status === 'saved'
        ? `${save.count === 1 ? '1 flag is' : `${save.count} flags are`} kept for review as suspected, unreviewed findings.`
        : save.status === 'error'
          ? `The flags could not be kept for review: ${save.message}`
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
            <TooltipTarget text={PUNCH_PENDING}>
              <Button variant="ghost" disabled>
                Punch from here
              </Button>
            </TooltipTarget>
          </div>
        </section>
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
