import { useState } from 'react';
import type { Finding, ReaperStatus, TakeComparisonEvidence, TakeComparisonMember, TakeComparisonWordStatus } from '../../types';
import { Button } from '../primitives/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { TooltipTarget } from '../primitives/Tooltip';
import { AuditionDialog } from './AuditionDialog';
import { formatTime } from './findingFormat';
import { divergenceLabel, METRIC_ROWS, metricValue, scriptSummary } from './takeComparisonFormat';
import { sourceFileName } from './takeReviewFormat';
import { useReadNavigation } from './useReadNavigation';

const NO_ITEM = 'This read has no REAPER item to go to. Scan the chapter again to find it where it is now.';

// How each word of the span is drawn in a read's strip. Colour is never the only sign: a word the read did not say as written
// is underlined or struck through, and a screen reader hears what happened to it.
const WORD_STYLE: Record<Exclude<TakeComparisonWordStatus, 'matched'>, { className: string; said: string }> = {
  misread: { className: 'underline decoration-wavy decoration-[var(--danger-text)] underline-offset-4', said: 'misread' },
  skipped: { className: 'line-through decoration-2', said: 'left out' },
  unread: { className: 'text-[var(--text-muted)] underline decoration-dotted underline-offset-4', said: 'not reached' },
};

/** A read's version of the span: every word of the script, marked where the read departs from it. */
function WordStrip({ evidence, member }: { evidence: TakeComparisonEvidence; member: TakeComparisonMember }) {
  const statuses = new Map(member.words.map((word) => [word.index, word.status]));
  return (
    <p className="mt-2 text-sm leading-7">
      {evidence.span.words.map((word, index) => {
        const status = statuses.get(word.index) ?? 'matched';
        const style = status === 'matched' ? undefined : WORD_STYLE[status];
        return (
          <span key={word.index}>
            {index > 0 && ' '}
            {style ? (
              <span className={style.className}>
                {word.text}
                <span className="sr-only"> ({style.said})</span>
              </span>
            ) : (
              word.text
            )}
          </span>
        );
      })}
    </p>
  );
}

/**
 * A take comparison (take-review-pickups-duplicates-take-intelligence.prd.md Phase 10, ADR 0165): the reads of one group set
 * side by side over the same part of the script. First how each read read the script, word by word, with every place it
 * departs listed with its time; then one table of the audio measurements, a row per category with what it measures and a
 * column per read, each figure measured or unavailable with its reason. Nothing adds the rows up, orders the reads or names a
 * best one (Q9): the narrator listens, chooses, and makes that take active in REAPER (Q8). Each read keeps its own Go to and
 * Loop in REAPER, and Audition plays two of them from their raw source.
 */
export function TakeComparisonView({
  finding,
  evidence,
  status,
  onStatusChange,
}: {
  finding: Finding;
  evidence: TakeComparisonEvidence;
  status: ReaperStatus | undefined;
  onStatusChange: () => Promise<void>;
}) {
  const { action, problem, done, connectionReason, looping, goTo, loop, stop } = useReadNavigation(finding, status, onStatusChange);
  const [auditioning, setAuditioning] = useState(false);
  const reads = evidence.members;
  const measured = reads.map((read, index) => ({ read, index })).filter(({ read }) => read.compared && read.metrics);
  const readName = (index: number) => `Read ${index + 1}`;

  return (
    <section aria-label="Takes side by side" className="mt-4">
      <h3 className="text-sm font-semibold">Takes side by side</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        Each read of this part of the script, over the same words. Every row is its own evidence: nothing here adds them up or picks a take. Listen, then choose
        the take you want in REAPER.
      </p>

      <h4 className="mt-4 text-sm font-semibold">How each read reads the script</h4>
      <ol className="mt-2 flex flex-col gap-2">
        {reads.map((read, index) => {
          const name = readName(index).toLowerCase();
          const blocked = (read.item_guid ? undefined : NO_ITEM) ?? connectionReason;
          return (
            <li key={`${read.item_guid}-${read.take_guid}-${index}`} className="rounded-md border border-[var(--border)] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium [overflow-wrap:anywhere]">
                    {readName(index)}: {sourceFileName(read.source_file)}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {formatTime(read.source_start)} to {formatTime(read.source_start + read.source_length)} in its file ·{' '}
                    {read.compared ? scriptSummary(read, evidence.span.words.length) : 'Not compared'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <TooltipTarget text={blocked ?? `Select ${name}'s item in REAPER and put the edit cursor on it`}>
                    <Button
                      variant="ghost"
                      aria-label={`Go to ${name} in REAPER`}
                      onClick={() => void goTo(index)}
                      disabled={Boolean(blocked) || action.isBlockedFor(`goto-${index}`)}
                      pending={action.isPending(`goto-${index}`)}
                    >
                      Go to
                    </Button>
                  </TooltipTarget>
                  <TooltipTarget text={blocked ?? `Play ${name} over and over in REAPER`}>
                    <Button
                      variant="ghost"
                      aria-label={`Loop ${name} in REAPER`}
                      onClick={() => void loop(index)}
                      disabled={Boolean(blocked) || action.isBlockedFor(`loop-${index}`)}
                      pending={action.isPending(`loop-${index}`)}
                    >
                      Loop
                    </Button>
                  </TooltipTarget>
                </div>
              </div>
              {read.compared ? (
                <>
                  <WordStrip evidence={evidence} member={read} />
                  {read.divergences.length > 0 && (
                    <ul aria-label={`Where ${name} departs from the script`} className="mt-1 list-disc pl-5 text-sm">
                      {read.divergences.map((divergence, position) => (
                        <li key={position}>{divergenceLabel(divergence)}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {read.not_compared_reason}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {measured.length > 0 && (
        <>
          <h4 className="mt-4 text-sm font-semibold">The audio of each read</h4>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Measured from each read&rsquo;s own source file, before REAPER&rsquo;s FX and edits.
          </p>
          <div className="mt-2 overflow-x-auto">
            <Table label="The audio of each read">
              <TableHead>
                <TableRow>
                  <TableHeader>Evidence</TableHeader>
                  {measured.map(({ index }) => (
                    <TableHeader key={index}>{readName(index)}</TableHeader>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {METRIC_ROWS.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <span className="font-medium">{row.label}</span>
                      <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                        {row.explains}
                      </span>
                    </TableCell>
                    {measured.map(({ read, index }) => {
                      const value = read.metrics ? metricValue(read.metrics, row.key) : { text: 'Not measured', unavailable: true };
                      return (
                        <TableCell key={index} className="[overflow-wrap:anywhere]">
                          <span style={value.unavailable ? { color: 'var(--text-muted)' } : undefined}>{value.text}</span>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {looping && (
          <Button variant="ghost" onClick={() => void stop()} disabled={action.isBlockedFor('stop')} pending={action.isPending('stop')}>
            Stop loop
          </Button>
        )}
        {reads.length >= 2 && (
          <TooltipTarget text="Play two reads side by side from their own audio files, without REAPER">
            <Button variant="ghost" onClick={() => setAuditioning(true)} disabled={action.isBusy}>
              Audition reads
            </Button>
          </TooltipTarget>
        )}
      </div>
      {connectionReason && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {connectionReason}
        </p>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {problem}
        </p>
      )}
      <p role="status" className="mt-2 text-sm empty:hidden">
        {done ?? (looping ? 'This finding is looping in REAPER.' : undefined)}
      </p>
      {auditioning && <AuditionDialog members={reads} onClose={() => setAuditioning(false)} />}
    </section>
  );
}
