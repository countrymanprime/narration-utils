import type { DiagnosticsFileResult, DiagnosticsSourceKind, DiagnosticsSummary, Finding } from '../../types';
import { severityLabel } from '../proof/findingFormat';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { formatLength } from './deliveryFormat';
import { cleanupClassLabel, cleanupLevelText, findingKindLabel, measuredText, sourceKindLabel, thresholdText, timeRangeText } from './diagnosticsFormat';

const MUTED = { color: 'var(--text-muted)' };
const SUMMARY_COLUMNS = 5;

/** The source kind the finding records, or the check's when a finding does not say. */
const findingSourceKind = (finding: Finding, fallback: DiagnosticsSourceKind): DiagnosticsSourceKind => {
  const recorded = finding.evidence?.source_kind;
  return recorded === 'raw_recording' || recorded === 'processed_render' ? recorded : fallback;
};

/** Why a file has no summary yet, or will not have one. */
function notChecked(file: DiagnosticsFileResult): string {
  switch (file.status) {
    case 'pending':
      return 'Waiting to be checked.';
    case 'checking':
      return 'Being checked now.';
    case 'cancelled':
      return 'Not checked: the diagnostics were cancelled.';
    default:
      return `Could not be checked: ${file.error ?? 'the file could not be read.'}`;
  }
}

function pacingText(summary: DiagnosticsSummary): string {
  if (summary.pacing.status === 'measured' && summary.words_per_minute !== null) return `${Math.round(summary.words_per_minute)} words a minute`;
  return `Not available: ${summary.pacing.reason ?? 'no transcript timing'}`;
}

/**
 * One row per file: what the analyzers found in it as counts (every clip region, even past the ones listed), how much of it is
 * silence, and the pacing, which needs transcript timing and says so without it. A file it could not read shows why instead.
 */
export function CheckedFilesTable({ files }: { files: readonly DiagnosticsFileResult[] }) {
  return (
    <Table label="Checked files" className="mt-3">
      <TableHead>
        <TableRow>
          <TableHeader>File</TableHeader>
          <TableHeader align="right">Length</TableHeader>
          <TableHeader align="right">Clip regions</TableHeader>
          <TableHeader align="right">Level shifts</TableHeader>
          <TableHeader align="right">Silence</TableHeader>
          <TableHeader>Pacing</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {files.map((file) => {
          const summary = file.status === 'checked' ? file.summary : null;
          return (
            <TableRow key={file.path}>
              <TableCell className="min-w-[9rem] font-medium [overflow-wrap:anywhere]">{file.name}</TableCell>
              {summary ? (
                <>
                  <TableCell numeric>{formatLength(summary.duration_seconds)}</TableCell>
                  <TableCell numeric>{summary.clip_regions}</TableCell>
                  <TableCell numeric>{summary.level_shifts}</TableCell>
                  <TableCell numeric>{`${summary.silences} (${formatLength(summary.silence_seconds)})`}</TableCell>
                  <TableCell className="min-w-[12rem] text-[0.8rem]" style={summary.pacing.status === 'measured' ? undefined : MUTED}>
                    {pacingText(summary)}
                  </TableCell>
                </>
              ) : (
                <TableCell colSpan={SUMMARY_COLUMNS} style={file.status === 'failed' ? { color: 'var(--danger-text)' } : MUTED}>
                  {notChecked(file)}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Every finding in file order, then time order: when in the file, what it is and how the analyzer rated it (in words, and why, from
 * its own reason), what was measured, the threshold that raised it, and the source it was measured in. No grade, and no action: the
 * table is read-only.
 */
export function FindingsTable({ files, sourceKind }: { files: readonly DiagnosticsFileResult[]; sourceKind: DiagnosticsSourceKind }) {
  const rows = files.flatMap((file) =>
    [...file.findings].sort((a, b) => (a.time_range?.start ?? 0) - (b.time_range?.start ?? 0)).map((finding) => ({ file, finding })),
  );
  return (
    <Table label="Findings" className="mt-4">
      <TableHead>
        <TableRow>
          <TableHeader>Time</TableHeader>
          <TableHeader>Finding</TableHeader>
          <TableHeader>Measured</TableHeader>
          <TableHeader>Threshold</TableHeader>
          <TableHeader>Source</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map(({ file, finding }) => (
          <TableRow key={`${file.path}:${finding.id}`}>
            <TableCell numeric align="left">
              {timeRangeText(finding)}
            </TableCell>
            <TableCell className="min-w-[14rem]">
              <span className="font-medium">{findingKindLabel(finding)}</span>
              <span className="ml-2 text-[0.75rem] font-semibold tracking-[0.03em] uppercase" style={finding.severity === 'info' ? MUTED : undefined}>
                {severityLabel(finding.severity)}
              </span>
              <span className="block text-[0.75rem]" style={MUTED}>
                {finding.confidence_reason}
              </span>
            </TableCell>
            <TableCell className="min-w-[10rem] font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.8rem]">{measuredText(finding)}</TableCell>
            <TableCell className="min-w-[10rem] text-[0.8rem]">{thresholdText(finding)}</TableCell>
            <TableCell className="min-w-[9rem] [overflow-wrap:anywhere]">
              <span className="font-medium">{file.name}</span>
              <span className="block text-[0.75rem]" style={MUTED}>{`${sourceKindLabel(findingSourceKind(finding, sourceKind))}, whole file`}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Every silence cleanup candidate in file order, then time order (ADR 0238 decision 3): its class, why the analyzer
 * called it that and how confident it is, its level, and the file it is in. Read-only and informational: nothing here
 * applies a cut. A candidate's own suggested split-and-trim range is not shown, since it never runs from this list.
 */
export function CleanupFindingsTable({ files }: { files: readonly DiagnosticsFileResult[] }) {
  const rows = files.flatMap((file) =>
    [...file.cleanupFindings].sort((a, b) => (a.time_range?.start ?? 0) - (b.time_range?.start ?? 0)).map((finding) => ({ file, finding })),
  );
  return (
    <Table label="Silence cleanup candidates" className="mt-3">
      <TableHead>
        <TableRow>
          <TableHeader>Time</TableHeader>
          <TableHeader>Class</TableHeader>
          <TableHeader>Why</TableHeader>
          <TableHeader>Level</TableHeader>
          <TableHeader>File</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map(({ file, finding }) => (
          <TableRow key={`${file.path}:${finding.id}`}>
            <TableCell numeric align="left">
              {timeRangeText(finding)}
            </TableCell>
            <TableCell className="min-w-[6rem] font-medium">{cleanupClassLabel(finding)}</TableCell>
            <TableCell className="min-w-[16rem] text-[0.8rem]">{finding.confidence_reason}</TableCell>
            <TableCell numeric align="left" className="min-w-[8rem]">
              {cleanupLevelText(finding)}
            </TableCell>
            <TableCell className="min-w-[9rem] [overflow-wrap:anywhere]">{file.name}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
