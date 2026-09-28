import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { PickupsState } from '../../types';
import { Button } from '../primitives/Button';
import { PanelHeader } from '../primitives/Panel';
import { StatusBadge } from '../primitives/StatusBadge';
import { analyzerLabel } from './findingFormat';
import type { ResolutionCounts } from './resolution';

// Triggers a browser "Save As" for the proofer's sheet without a native file dialog: the WebView2 host handles a
// download the way a browser does (the Pickups page exports the same way).
function downloadCSV(csv: string, name: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Where Proof's notes come from, in mock 04's words ("Sources: proofer J. Ortiz (CSV) · local AI compare · my flags").
// Only the sources that actually have notes are named; the mock's proofer name and "my flags" have no data behind them
// (the pickup sheet carries no proofer name, and there is no narrator flag store), so they are left out.
const SOURCE_WORDS: Record<string, string> = {
  'transcript-compare': 'local AI compare',
  'story-bible': 'Story Bible',
  'take-review': 'take review',
  'take-comparison': 'take comparison',
  measure: 'delivery measurement',
};

// Mock 04's order: the proofer first, then the local AI compare, then the rest as the host lists them.
const SOURCE_ORDER = Object.keys(SOURCE_WORDS);
const rank = (analyzer: string) => (SOURCE_ORDER.includes(analyzer) ? SOURCE_ORDER.indexOf(analyzer) : SOURCE_ORDER.length);

export function sourcesOf(analyzers: readonly string[], proofer: boolean): string[] {
  const words = [...analyzers].sort((a, b) => rank(a) - rank(b)).map((analyzer) => SOURCE_WORDS[analyzer] ?? analyzerLabel(analyzer).toLowerCase());
  return [...(proofer ? ['proofer (CSV)'] : []), ...new Set(words)];
}

/** Mock 04's "Sources:" pill beside the page title (PF4). Nothing is drawn while no source has notes. */
export function SourcesLine({ analyzers, proofer }: { analyzers: readonly string[]; proofer: boolean }) {
  const sources = sourcesOf(analyzers, proofer);
  if (sources.length === 0) return null;
  return (
    <p className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs [overflow-wrap:anywhere]">
      <span className="font-semibold">Sources:</span> <span>{sources.join(' · ')}</span>
    </p>
  );
}

/**
 * The notes table's header (mock 04): "Notes · 14", the resolution chips ("6 need pickup", "5 fix in edit", "3 waived")
 * and the proofer's sheet in and out (D85 #8: "Import proofer sheet", "Export for proofer", on Proof's notes header).
 * The sheet is the proofer's pickup list, the same one the Pickups page reads (`pickupsImport`, `pickupsExport`): a
 * pickup lands as a REAPER marker, so both need REAPER running, and the host says so when it isn't.
 */
export function NotesHeader({ total, counts, pickups }: { total: number; counts: ResolutionCounts; pickups: PickupsState }) {
  const api = useApi();
  const fileInput = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');
  const [rowErrors, setRowErrors] = useState<string[]>([]);

  useEffect(() => {
    if (pickups.phase === 'success' && pickups.csv) downloadCSV(pickups.csv, 'pickups-for-proofer.csv');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per completed export (a fresh runId), not on every render
  }, [pickups.runId, pickups.csv]);

  const importSheet = async (file: File) => {
    setProblem('');
    setRowErrors([]);
    try {
      const result = await api.pickupsImport(await file.text());
      setRowErrors(result.rowErrors);
    } catch (reason: unknown) {
      setProblem(String(reason));
    }
  };
  const exportSheet = () => {
    setProblem('');
    api.pickupsExport().catch((reason: unknown) => setProblem(String(reason)));
  };

  const chips = [
    { count: counts.toReview, label: 'to review', tone: 'neutral' as const },
    { count: counts.pickup, label: 'need pickup', tone: 'danger' as const },
    { count: counts.edit, label: 'fix in edit', tone: 'warning' as const },
    { count: counts.waived, label: 'waived', tone: 'success' as const },
    { count: counts.deferred, label: 'deferred', tone: 'info' as const },
  ].filter((chip) => chip.count > 0);

  const messages = rowErrors.length > 0 || problem || pickups.phase === 'error' || (pickups.phase === 'success' && pickups.importReport);

  return (
    <>
      <PanelHeader
        title={`Notes · ${total}`}
        subtitle={
          chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <StatusBadge key={chip.label} tone={chip.tone} label={`${chip.count} ${chip.label}`} />
              ))}
            </div>
          )
        }
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importSheet(file);
              }}
            />
            <Button variant="secondary" onClick={() => fileInput.current?.click()} pending={pickups.phase === 'importing'}>
              Import proofer sheet
            </Button>
            <Button variant="secondary" onClick={exportSheet} disabled={pickups.total === 0} pending={pickups.phase === 'exporting'}>
              Export for proofer
            </Button>
          </>
        }
      />
      {messages && (
        <div className="px-4 pt-2">
          {rowErrors.length > 0 && (
            <p className="text-sm" style={{ color: 'var(--warn-text)' }}>
              {rowErrors.length} row{rowErrors.length === 1 ? '' : 's'} of the sheet could not be used: {rowErrors.join('; ')}
            </p>
          )}
          {(problem || pickups.phase === 'error') && (
            <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
              {problem || pickups.message}
            </p>
          )}
          {pickups.phase === 'success' && pickups.importReport && (
            <p role="status" className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {pickups.message}
            </p>
          )}
        </div>
      )}
    </>
  );
}
