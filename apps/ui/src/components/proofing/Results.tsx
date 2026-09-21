import { Fragment } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExport, faFileLines, faHeadphones, faPlus, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import type { Discrepancy, TranscriptState } from '../../types';
import { canAddEquivalence } from '../../state';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { TooltipTarget } from '../primitives/Tooltip';
import { InlineDiffRow, KIND_STYLES } from './InlineDiffRow';
import { IconButton } from '../primitives/IconButton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';

const TYPE_CHIP_BG: Record<string, string> = {
  MISREAD: 'bg-[var(--review-soft)]',
  SKIPPED: 'bg-[var(--accent-soft)]',
  EXTRA: 'bg-[var(--place-soft)]',
};

const seconds = (value: number) =>
  `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(value % 60)
    .toString()
    .padStart(2, '0')}`;

export function Results({
  state,
  selected,
  select,
  notify,
  goToManuscript,
  reset,
  canExportMarkers,
}: {
  state: TranscriptState;
  selected?: Discrepancy;
  select: (row?: Discrepancy) => void;
  notify: (text: string) => void;
  goToManuscript: (row: Discrepancy) => void;
  reset: () => void;
  canExportMarkers: boolean;
}) {
  const api = useApi();
  const pendingMarkers = state.rows.filter((row) => (row.markerState ?? 'pending') === 'pending').length;
  const exporting = state.markerExport.phase === 'exporting';
  const markerState = (row: Discrepancy) => row.markerState ?? 'pending';
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
        <h2 className="text-sm font-semibold">Discrepancies</h2>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-[0.35rem] rounded-full px-[0.55rem] py-[0.15rem] font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.03em] uppercase"
            style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
          >
            {state.rows.length} found
          </span>
          <TooltipTarget
            text={
              !canExportMarkers
                ? 'Marker export is available only for results from this active REAPER session'
                : pendingMarkers === 0
                  ? 'No new markers are ready to export'
                  : `Export ${pendingMarkers} new marker${pendingMarkers === 1 ? '' : 's'} to REAPER`
            }
          >
            <Button
              variant="primary"
              className="text-xs"
              disabled={!canExportMarkers || pendingMarkers === 0 || exporting}
              onClick={async () => {
                try {
                  await api.transcriptExportMarkers();
                  notify(`Exporting ${pendingMarkers} marker${pendingMarkers === 1 ? '' : 's'} to REAPER…`);
                } catch (error) {
                  notify(String(error));
                }
              }}
            >
              <FontAwesomeIcon icon={faFileExport} />
              {exporting ? 'Exporting…' : `Export ${pendingMarkers} marker${pendingMarkers === 1 ? '' : 's'}`}
            </Button>
          </TooltipTarget>
          <TooltipTarget text="Return to setup for another comparison">
            <Button variant="ghost" className="text-xs" onClick={reset}>
              <FontAwesomeIcon icon={faRotateLeft} />
              New comparison
            </Button>
          </TooltipTarget>
        </div>
      </div>
      {state.rows.length === 0 ? (
        <p className="p-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          No discrepancies found.
        </p>
      ) : (
        <div className="overflow-auto">
          <Table label="Discrepancies">
            <TableHead>
              <TableRow>
                <TableHeader>Type</TableHeader>
                <TableHeader>Script</TableHeader>
                <TableHeader>Heard</TableHeader>
                <TableHeader>Time</TableHeader>
                <TableHeader>Marker</TableHeader>
                <TableHeader>Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.rows.map((row) => {
                const eligible = canAddEquivalence(row);
                const isSelected = row.id === selected?.id;
                return (
                  <Fragment key={row.id}>
                    <TableRow selected={isSelected} onActivate={() => select(isSelected ? undefined : row)}>
                      <TableCell>
                        <span
                          className={`rounded px-[0.45rem] py-[0.1rem] font-['Barlow_Condensed',sans-serif] text-[0.68rem] font-bold tracking-[0.03em] ${TYPE_CHIP_BG[row.kind] ?? TYPE_CHIP_BG.MISREAD}`}
                          style={{ color: (KIND_STYLES[row.kind] ?? KIND_STYLES.MISREAD).color }}
                        >
                          {row.kind}
                        </span>
                      </TableCell>
                      <TableCell className="font-['IBM_Plex_Mono',ui-monospace,monospace]">{row.docText || '—'}</TableCell>
                      <TableCell className="font-['IBM_Plex_Mono',ui-monospace,monospace]" style={{ color: 'var(--text-muted)' }}>
                        {row.audioText || '—'}
                      </TableCell>
                      <TableCell className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-faint)' }}>
                        {seconds(row.projectTime)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {markerState(row) === 'pending' && (
                          <span className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-[0.45rem] py-[0.18rem] text-[0.68rem] font-semibold whitespace-nowrap text-[var(--accent-strong)]">
                            Ready to export
                          </span>
                        )}
                        {markerState(row) === 'exported' && (
                          <span className="inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--character)_18%,transparent)] px-[0.45rem] py-[0.18rem] text-[0.68rem] font-semibold whitespace-nowrap text-[var(--character)]">
                            Exported
                          </span>
                        )}
                        {markerState(row) === 'existing' && (
                          <TooltipTarget text={row.existingMarkerName ? `Existing marker: ${row.existingMarkerName}` : 'A matching marker already exists'}>
                            <span className="inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--warn)_18%,transparent)] px-[0.45rem] py-[0.18rem] text-[0.68rem] font-semibold whitespace-nowrap text-[var(--warn)]">
                              Already marked
                            </span>
                          </TooltipTarget>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                          <TooltipTarget className="flex-none" text={row.chapter ? 'Jump to script in Manuscript' : 'No manuscript source is available'}>
                            <IconButton label="Jump to manuscript" disabled={!row.chapter} onClick={() => goToManuscript(row)}>
                              <FontAwesomeIcon icon={faFileLines} />
                            </IconButton>
                          </TooltipTarget>
                          <TooltipTarget className="flex-none" text={`Play heard audio at ${seconds(row.projectTime)}`}>
                            <IconButton label="Play recorded audio" disabled={!row.projectTime} onClick={() => void api.transcriptJump(row.id)}>
                              <FontAwesomeIcon icon={faHeadphones} />
                            </IconButton>
                          </TooltipTarget>
                          <TooltipTarget className="flex-none" text={eligible ? 'Add pronunciation equivalence' : 'Only available for single-word misreads'}>
                            <IconButton
                              label="Add pronunciation equivalence"
                              disabled={!eligible}
                              onClick={async () => {
                                try {
                                  notify(await api.transcriptAddEquivalence(row.id));
                                } catch (error) {
                                  notify(String(error));
                                }
                              }}
                            >
                              <FontAwesomeIcon icon={faPlus} />
                            </IconButton>
                          </TooltipTarget>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isSelected && <InlineDiffRow row={row} />}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {state.markerExport.phase !== 'idle' && (
        <p
          className={`px-3 pb-3 text-xs ${state.markerExport.phase === 'error' ? 'text-red-400' : ''}`}
          style={{ color: state.markerExport.phase === 'error' ? undefined : 'var(--text-muted)' }}
        >
          {state.markerExport.message}
        </p>
      )}
    </section>
  );
}
