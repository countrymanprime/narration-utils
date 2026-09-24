import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowDown, faArrowUp } from '@fortawesome/free-solid-svg-icons';
import type { DeliveryProfile, DeliveryRule, DeliveryRuleResult, MeasureFileResult, MeasureReport } from '../../types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { formatBound, formatRuleValue } from './deliveryProfile';
import { Mark, ResultIcon } from './RuleBadges';

const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace] whitespace-nowrap";
const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };

/** Why a file has no measurements yet, or will not have any. */
function notMeasured(file: MeasureFileResult): string {
  switch (file.status) {
    case 'pending':
      return 'Waiting to be measured.';
    case 'measuring':
      return 'Being measured now.';
    case 'cancelled':
      return 'Not measured: the measurement was cancelled.';
    default:
      return `Could not be measured: ${file.error ?? 'the file could not be read.'}`;
  }
}

export function describeFormat(report: MeasureReport): string {
  const rate = `${(report.sample_rate / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} kHz`;
  return `${rate} · ${report.channels === 1 ? 'mono' : report.channels === 2 ? 'stereo' : `${report.channels} channels`}`;
}

/** One column of the table: a file rule, or rules that belong together (room tone at the head and the tail). */
export type RuleColumn = { key: string; label: string; sub: string; rules: DeliveryRule[] };

/**
 * The profile's file rules as columns, in the profile's order. Rules whose ids differ only by a `_head` or `_tail` ending share
 * one column ("Room tone", head · tail), as the mockup draws them.
 */
export function ruleColumns(profile: DeliveryProfile): RuleColumn[] {
  const columns: RuleColumn[] = [];
  for (const rule of profile.rules.filter((candidate) => candidate.scope === 'file')) {
    const key = rule.id.replace(/_(head|tail)$/, '');
    const column = columns.find((existing) => existing.key === key);
    if (column) column.rules.push(rule);
    else columns.push({ key, label: rule.label, sub: '', rules: [rule] });
  }
  return columns.map((column) =>
    column.rules.length > 1
      ? { ...column, label: column.rules[0].label.split(',')[0], sub: column.rules.map((rule) => rule.label.split(', ')[1] ?? rule.label).join(' · ') }
      : { ...column, sub: column.rules[0].off ? 'off' : formatBound(column.rules[0]) },
  );
}

const resultOf = (file: MeasureFileResult, rule: DeliveryRule): DeliveryRuleResult | undefined => file.rules.find((result) => result.ruleId === rule.id);

/** How a missed value missed, in a few words under it: "below −23", "above −3", "not 44.1 kHz". */
function missWords(rule: DeliveryRule, result: DeliveryRuleResult): string {
  switch (result.violation) {
    case 'below_min':
      return rule.min !== null ? `below ${formatRuleValue(rule, rule.min)}` : 'below the minimum';
    case 'above_max':
      return rule.max !== null ? `above ${formatRuleValue(rule, rule.max)}` : 'above the maximum';
    case 'not_one_of':
      return `not ${formatBound(rule)}`;
  }
  return '';
}

function RuleCell({ column, file }: { column: RuleColumn; file: MeasureFileResult }) {
  const results = column.rules.map((rule) => ({ rule, result: resultOf(file, rule) }));
  // Rules the app did not judge for this file share one word, whatever the number of rules in the column.
  if (results.every(({ result }) => result?.status === 'not_checked')) {
    return (
      <TableCell className="text-[0.8rem] whitespace-nowrap italic" style={MUTED}>
        <ResultIcon status="not_checked" />
        Not checked
      </TableCell>
    );
  }
  if (results.every(({ result }) => result?.status === 'off')) {
    return (
      <TableCell className="text-[0.8rem] italic" style={MUTED}>
        Off
      </TableCell>
    );
  }
  return (
    <TableCell className="align-top">
      {results.map(({ rule, result }) => (
        <ResultLine key={rule.id} rule={rule} result={result} />
      ))}
    </TableCell>
  );
}

function ResultLine({ rule, result }: { rule: DeliveryRule; result?: DeliveryRuleResult }) {
  if (!result || result.status === 'not_measurable' || result.value === null) {
    return (
      <span className="block text-[0.8rem] italic" style={MUTED}>
        {result?.status === 'off' ? 'Off' : result?.status === 'not_checked' ? 'Not checked' : 'Not measurable'}
      </span>
    );
  }
  const missed = result.status === 'not_met';
  return (
    <span className="block">
      <span className={`${MONO} inline-flex items-center ${missed ? 'font-semibold' : ''}`} style={missed ? DANGER : undefined}>
        <ResultIcon status={result.status} />
        {formatRuleValue(rule, result.value)}
      </span>
      <span className="block text-[0.72rem]" style={missed ? DANGER : MUTED}>
        {missed ? (
          <>
            {(result.violation === 'above_max' || result.violation === 'below_min') && (
              <FontAwesomeIcon icon={result.violation === 'above_max' ? faArrowUp : faArrowDown} className="mr-1" aria-hidden="true" />
            )}
            Not met <span className="whitespace-nowrap">{missWords(rule, result)}</span>
          </>
        ) : (
          'Met'
        )}
      </span>
    </span>
  );
}

/** A file's results counted: met, not met, not checked (by the app, or turned off), not measurable. */
export function countResults(results: readonly DeliveryRuleResult[]) {
  const count = (status: DeliveryRuleResult['status']) => results.filter((result) => result.status === status).length;
  return { met: count('met'), notMet: count('not_met'), notChecked: count('not_checked'), notMeasurable: count('not_measurable'), off: count('off') };
}

function ResultSummary({ file }: { file: MeasureFileResult }) {
  const counts = countResults(file.rules);
  const rest = [
    counts.notMet > 0 && counts.met > 0 ? `${counts.met} met` : '',
    counts.notChecked > 0 ? `${counts.notChecked} not checked` : '',
    counts.notMeasurable > 0 ? `${counts.notMeasurable} not measurable` : '',
    counts.off > 0 ? `${counts.off} off` : '',
  ].filter(Boolean);
  return (
    <TableCell className="align-top">
      {counts.notMet > 0 ? <Mark tone="danger">{`${counts.notMet} not met`}</Mark> : <Mark tone="ok">{`${counts.met} met`}</Mark>}
      {rest.length > 0 && (
        <span className="mt-1 block text-[0.72rem] whitespace-nowrap" style={MUTED}>
          {rest.join(' · ')}
        </span>
      )}
    </TableCell>
  );
}

/**
 * One row per picked file (delivery-platform-profiles.prd.md Phase 3, mockups 02 and 03): a column per file rule of the profile,
 * each value with its result in words as well as colour, a rule the app cannot check written as "Not checked" (never a pass), and
 * the file's result counted. A file that could not be read shows why instead. Pressing a row opens the file's detail.
 */
export function MeasurementsTable({
  files,
  profile,
  selected,
  onSelect,
}: {
  files: readonly MeasureFileResult[];
  profile: DeliveryProfile;
  selected?: string;
  onSelect: (path: string) => void;
}) {
  const columns = ruleColumns(profile);
  return (
    <Table label="Measurements" className="mt-3">
      <TableHead>
        <TableRow>
          <TableHeader>File</TableHeader>
          {columns.map((column) => (
            <TableHeader key={column.key} className="whitespace-pre-line">{`${column.label}\n${column.sub}`}</TableHeader>
          ))}
          <TableHeader>Result</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {files.map((file) => {
          const report = file.status === 'measured' ? file.report : null;
          return (
            <TableRow key={file.path} onActivate={report ? () => onSelect(file.path) : undefined} selected={selected === file.path}>
              <TableCell className="min-w-[9rem] align-top [overflow-wrap:anywhere]">
                <span className="font-medium">{file.name}</span>
                {report && (
                  <span className="block text-[0.75rem]" style={MUTED}>
                    {describeFormat(report)}
                  </span>
                )}
              </TableCell>
              {report ? (
                <>
                  {columns.map((column) => (
                    <RuleCell key={column.key} column={column} file={file} />
                  ))}
                  <ResultSummary file={file} />
                </>
              ) : (
                <TableCell colSpan={columns.length + 1} className="text-sm" style={file.status === 'failed' ? DANGER : MUTED}>
                  {notMeasured(file)}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
