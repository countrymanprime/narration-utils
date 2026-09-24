import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowDown, faArrowUp } from '@fortawesome/free-solid-svg-icons';
import type { MeasureFileResult, MeasureReport } from '../../types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { DELIVERY_METRICS, formatLength, formatLevel, judge, type DeliveryLimits, type Judgement } from './deliveryLimits';

const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace] whitespace-nowrap";
const MUTED = { color: 'var(--text-muted)' };
const METRIC_COLUMNS = DELIVERY_METRICS.length + 2;

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

function describeFormat(report: MeasureReport): string {
  const rate = `${(report.sample_rate / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} kHz`;
  return `${rate} · ${report.channels === 1 ? 'mono' : report.channels === 2 ? 'stereo' : `${report.channels} channels`}`;
}

function MetricCell({ value, judgement }: { value: number | null; judgement: Judgement }) {
  if (value === null || judgement.kind === 'unavailable') {
    return (
      <TableCell align="right" className="text-[0.8rem] italic" style={MUTED}>
        Not measurable
      </TableCell>
    );
  }
  if (judgement.kind === 'above' || judgement.kind === 'below') {
    return (
      <TableCell align="right" className={MONO} style={{ color: 'var(--danger-text)' }}>
        <span className="font-semibold">{formatLevel(value)}</span>
        <span className="block text-[0.72rem]">
          <FontAwesomeIcon icon={judgement.kind === 'above' ? faArrowUp : faArrowDown} className="mr-1" aria-hidden="true" />
          {judgement.kind} {formatLevel(judgement.limit)}
        </span>
      </TableCell>
    );
  }
  return (
    <TableCell align="right" className={MONO}>
      {formatLevel(value)}
    </TableCell>
  );
}

/**
 * One row per picked file (diagnostics PRD user flow step 3): every measurement with its unit in the column header, a value that could
 * not be measured written as "Not measurable" (never a number, ADR 0025), a value outside the narrator's limit marked with the limit it
 * broke in words as well as colour, and a file that could not be read with the reason instead of numbers.
 */
export function MeasurementsTable({ files, limits }: { files: readonly MeasureFileResult[]; limits: DeliveryLimits | undefined }) {
  return (
    <Table label="Measurements" className="mt-3">
      <TableHead>
        <TableRow>
          <TableHeader>File</TableHeader>
          {DELIVERY_METRICS.map((metric) => (
            <TableHeader key={metric.key} align="right">{`${metric.label} (${metric.unit})`}</TableHeader>
          ))}
          <TableHeader align="right">Length</TableHeader>
          <TableHeader align="right">Silent windows</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {files.map((file) => {
          const report = file.status === 'measured' ? file.report : null;
          return (
            <TableRow key={file.path}>
              <TableCell className="min-w-[9rem] [overflow-wrap:anywhere]">
                <span className="font-medium">{file.name}</span>
                {report && (
                  <span className="block text-[0.75rem]" style={MUTED}>
                    {describeFormat(report)}
                  </span>
                )}
              </TableCell>
              {report ? (
                <>
                  {DELIVERY_METRICS.map((metric) => {
                    const value = report[metric.key];
                    return <MetricCell key={metric.key} value={value} judgement={judge(value, limits?.[metric.key] ?? {})} />;
                  })}
                  <TableCell align="right" className={MONO}>
                    {formatLength(report.duration_seconds)}
                  </TableCell>
                  <TableCell align="right" className={MONO}>
                    {report.digital_silent_windows}
                  </TableCell>
                </>
              ) : (
                <TableCell colSpan={METRIC_COLUMNS} className="text-sm" style={file.status === 'failed' ? { color: 'var(--danger-text)' } : MUTED}>
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

/** How many measured values are outside the narrator's limits, and how many could not be measured, across every file. */
export function tally(files: readonly MeasureFileResult[], limits: DeliveryLimits | undefined): { outside: number; unavailable: number } {
  let outside = 0;
  let unavailable = 0;
  for (const file of files) {
    if (file.status !== 'measured' || !file.report) continue;
    for (const metric of DELIVERY_METRICS) {
      const kind = judge(file.report[metric.key], limits?.[metric.key] ?? {}).kind;
      if (kind === 'above' || kind === 'below') outside += 1;
      if (kind === 'unavailable') unavailable += 1;
    }
  }
  return { outside, unavailable };
}
