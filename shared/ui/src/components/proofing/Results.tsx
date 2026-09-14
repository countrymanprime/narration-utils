import { Fragment } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faHeadphones, faPlus, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import type { Discrepancy, TranscriptState } from '../../types';
import { canAddEquivalence } from '../../state';
import { useApi } from '../../api/ApiContext';
import { TooltipTarget } from '../primitives/Tooltip';
import { InlineDiffRow, KIND_STYLES } from './InlineDiffRow';

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
}: {
  state: TranscriptState;
  selected?: Discrepancy;
  select: (row?: Discrepancy) => void;
  notify: (text: string) => void;
  goToManuscript: (row: Discrepancy) => void;
  reset: () => void;
}) {
  const api = useApi();
  return (
    <section className="panel proofing-results">
      <div className="panel-head">
        <h2 className="text-sm font-semibold">Discrepancies</h2>
        <div className="flex items-center gap-2">
          <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            {state.rows.length} found
          </span>
          <TooltipTarget text="Return to setup for another comparison">
            <button className="btn btn-ghost text-xs" onClick={reset}>
              <FontAwesomeIcon icon={faRotateLeft} />
              New comparison
            </button>
          </TooltipTarget>
        </div>
      </div>
      {state.rows.length === 0 ? (
        <p className="p-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          No discrepancies found.
        </p>
      ) : (
        <div className="overflow-auto">
          <table className="dtable proofing-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Script</th>
                <th>Heard</th>
                <th>Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => {
                const eligible = canAddEquivalence(row);
                const isSelected = row.id === selected?.id;
                return (
                  <Fragment key={row.id}>
                    <tr data-row className={isSelected ? 'row-selected' : ''} onClick={() => select(isSelected ? undefined : row)}>
                      <td className="align-middle">
                        <span className={`type-chip type-${row.kind}`} style={{ color: (KIND_STYLES[row.kind] ?? KIND_STYLES.MISREAD).color }}>
                          {row.kind}
                        </span>
                      </td>
                      <td className="f-mono align-middle">{row.docText || '—'}</td>
                      <td className="f-mono align-middle" style={{ color: 'var(--text-muted)' }}>
                        {row.audioText || '—'}
                      </td>
                      <td className="f-mono align-middle text-xs" style={{ color: 'var(--text-faint)' }}>
                        {seconds(row.projectTime)}
                      </td>
                      <td className="align-middle">
                        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                          <TooltipTarget text={row.chapter ? 'Jump to script in Manuscript' : 'No manuscript source is available'}>
                            <button aria-label="Jump to manuscript" className="icon-btn" disabled={!row.chapter} onClick={() => goToManuscript(row)}>
                              <FontAwesomeIcon icon={faFileLines} />
                            </button>
                          </TooltipTarget>
                          <TooltipTarget text={`Play heard audio at ${seconds(row.projectTime)}`}>
                            <button
                              aria-label="Play recorded audio"
                              className="icon-btn"
                              disabled={!row.projectTime}
                              onClick={() => void api.transcriptJump(row.id)}
                            >
                              <FontAwesomeIcon icon={faHeadphones} />
                            </button>
                          </TooltipTarget>
                          <TooltipTarget text={eligible ? 'Add pronunciation equivalence' : 'Only available for single-word misreads'}>
                            <button
                              aria-label="Add pronunciation equivalence"
                              disabled={!eligible}
                              className="icon-btn"
                              onClick={async () => {
                                try {
                                  notify(await api.transcriptAddEquivalence(row.id));
                                } catch (error) {
                                  notify(String(error));
                                }
                              }}
                            >
                              <FontAwesomeIcon icon={faPlus} />
                            </button>
                          </TooltipTarget>
                        </div>
                      </td>
                    </tr>
                    {isSelected && <InlineDiffRow row={row} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
