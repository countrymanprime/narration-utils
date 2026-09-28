import type { DeliveryProfile, DeliveryRuleResult, MeasureFileResult, MeasureReport } from '../../types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { formatLength, formatLevel } from './deliveryFormat';
import { fileVerdict, leftToCheck } from './fileVerdict';
import { Mark } from './RuleBadges';

const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace] whitespace-nowrap";
const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };
const WARN = { color: 'var(--warn-text)' };

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

/** The host's result for the profile's rule on a metric, when the profile has one for it. */
function resultFor(file: MeasureFileResult, profile: DeliveryProfile, metrics: readonly string[]): DeliveryRuleResult | undefined {
  const rule = profile.rules.find((candidate) => candidate.scope === 'file' && metrics.includes(candidate.metric));
  return rule ? file.rules.find((result) => result.ruleId === rule.id) : undefined;
}

/**
 * One level: its value, in red when the profile's rule on it was not met (said in words too, for a screen reader), in amber when
 * the rule met but raised advice (a true peak over the limit after MP3 encoding), and a dash when it could not be measured.
 */
function LevelCell({ value, result }: { value: number | null; result?: DeliveryRuleResult }) {
  if (value === null) {
    return (
      <TableCell className={MONO} style={MUTED}>
        <span aria-hidden="true">–</span>
        <span className="sr-only">Not measurable</span>
      </TableCell>
    );
  }
  const missed = result?.status === 'not_met';
  const advised = !missed && !!result?.advice;
  return (
    <TableCell className={`${MONO} ${missed ? 'font-semibold' : ''}`} style={missed ? DANGER : advised ? WARN : undefined}>
      {formatLevel(value)}
      {missed && <span className="sr-only"> (not met)</span>}
      {advised && <span className="sr-only"> (advice: {result?.advice})</span>}
    </TableCell>
  );
}

function RoomToneCell({ file, profile, report }: { file: MeasureFileResult; profile: DeliveryProfile; report: MeasureReport }) {
  const head = resultFor(file, profile, ['head_room_tone_seconds']);
  const tail = resultFor(file, profile, ['tail_room_tone_seconds']);
  const seconds = (value: number | null, result?: DeliveryRuleResult) =>
    value === null ? (
      '–'
    ) : (
      <span style={result?.status === 'not_met' ? DANGER : undefined}>
        {value.toFixed(1)}
        {result?.status === 'not_met' && <span className="sr-only"> (not met)</span>}
      </span>
    );
  return (
    <TableCell className={MONO}>
      {seconds(report.head_room_tone_seconds, head)} / {seconds(report.tail_room_tone_seconds, tail)}
    </TableCell>
  );
}

function ResultCell({ file }: { file: MeasureFileResult }) {
  const verdict = fileVerdict(file);
  const left = leftToCheck(file);
  return (
    <TableCell className="text-right whitespace-nowrap">
      {verdict === 'fail' ? <Mark tone="danger">Fail</Mark> : verdict === 'pass' ? <Mark tone="ok">Pass</Mark> : <Mark tone="muted">Not judged</Mark>}
      {left > 0 && (
        <span className="mt-0.5 block text-[0.72rem]" style={MUTED}>
          {left} to check yourself
        </span>
      )}
    </TableCell>
  );
}

/**
 * Per-file checks (stage-navigation-and-page-replacement.prd.md Phase 8, mock 05; delivery-platform-profiles.prd.md Phase 3): one
 * row per picked file with the mock's columns, each level coloured by the host's judgement of the profile's rule on it, and the
 * file's verdict. A file that could not be read says why instead. Pressing a row opens why it fails, and every rule behind it.
 * Mock 05's Clicks and Text columns are left out: nothing measures clicks or text coverage per rendered file yet.
 */
export function PerFileChecks({
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
  return (
    <Table label="Per-file checks" className="mt-3">
      <TableHead>
        <TableRow>
          <TableHeader>File</TableHeader>
          <TableHeader>Length</TableHeader>
          <TableHeader>RMS</TableHeader>
          <TableHeader>True peak</TableHeader>
          <TableHeader>Noise floor</TableHeader>
          <TableHeader>Head / Tail</TableHeader>
          <TableHeader className="text-right">Result</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {files.map((file) => {
          const report = file.status === 'measured' ? file.report : null;
          const failed = fileVerdict(file) === 'fail';
          return (
            <TableRow key={file.path} onActivate={report ? () => onSelect(file.path) : undefined} selected={selected === file.path}>
              <TableCell className="min-w-[9rem] [overflow-wrap:anywhere]">
                <span className={failed ? 'font-semibold' : 'font-medium'}>{file.name}</span>
                {report && (
                  <span className="block text-[0.72rem]" style={MUTED}>
                    {describeFormat(report)}
                  </span>
                )}
              </TableCell>
              {report ? (
                <>
                  <TableCell className={MONO}>{formatLength(report.duration_seconds)}</TableCell>
                  <LevelCell value={report.rms_dbfs} result={resultFor(file, profile, ['rms_dbfs'])} />
                  <LevelCell value={report.true_peak_dbtp} result={resultFor(file, profile, ['true_peak_dbtp', 'sample_peak_dbfs'])} />
                  <LevelCell value={report.noise_floor_dbfs} result={resultFor(file, profile, ['noise_floor_dbfs'])} />
                  <RoomToneCell file={file} profile={profile} report={report} />
                  <ResultCell file={file} />
                </>
              ) : (
                <TableCell colSpan={6} className="text-sm" style={file.status === 'failed' ? DANGER : MUTED}>
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
