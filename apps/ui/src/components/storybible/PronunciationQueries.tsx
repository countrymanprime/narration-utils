import { useCallback, useEffect, useState } from 'react';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { GuidePronunciationStatus, PronunciationQuery } from '../../types';
import { onlineBatchWords } from '../../pronunciationOnlineWords';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Select } from '../primitives/Select';
import { SlideOver } from '../primitives/SlideOver';
import { StatusBadge } from '../primitives/StatusBadge';
import type { Notify } from '../primitives/Toast';
import { pronunciationSourceLabel, pronunciationStatusInfo } from './pronunciationStatus';

// Saves the CSV the host wrote as a browser download: the WebView2 host handles it like a real browser's "Save As", so no native file
// dialog binding is needed (the pickup list's export does the same, PickupsDialog.tsx).
function downloadCSV(csv: string, name: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type Filter = 'open' | 'query_sent' | 'researched';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'All not confirmed' },
  { value: 'query_sent', label: 'Query sent' },
  { value: 'researched', label: 'Researched' },
];

const queryKey = (row: PronunciationQuery) => `${row.entityId}:${row.aliasIndex ?? ''}`;

// The pronunciation queries (prep-depth P3): every name whose pronunciation the author has not confirmed, in reading order. Export saves
// them as CSV to send to the author; Mark sent and Mark answered set a row's status, and an answered row leaves the list. The list is
// the host's (derived from the Story Bible on every read), so it is loaded when the panel opens and after each change.
export function PronunciationQueries({ open, onClose, onChanged, notify }: { open: boolean; onClose: () => void; onChanged: () => void; notify: Notify }) {
  const api = useApi();
  const mutation = usePendingAction();
  const [rows, setRows] = useState<PronunciationQuery[]>();
  const [loadError, setLoadError] = useState<string>();
  const [filter, setFilter] = useState<Filter>('open');
  const [confirmOnline, setConfirmOnline] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.guidePronunciationQueries());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeApiError(error));
    }
  }, [api]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const setStatus = (row: PronunciationQuery, status: GuidePronunciationStatus, message: string) =>
    mutation.run(`${status}:${queryKey(row)}`, async () => {
      try {
        await api.guidePronunciationSetStatus(row.entityId, status, undefined, row.aliasIndex ?? undefined);
        notify(message);
        await load();
        onChanged();
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });
  const exportCsv = () =>
    mutation.run('export', async () => {
      try {
        const result = await api.guidePronunciationQueriesCsv();
        downloadCSV(result.csv, 'pronunciation-queries.csv');
        notify(`${result.count} ${result.count === 1 ? 'query' : 'queries'} exported.`);
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  // Q11: a batch online lookup is opt-in with a notice naming how many words it sends; the host refuses a batch whose confirmed count
  // is not that number, so the notice and the request are counted by the same rule (pronunciationOnlineWords.ts).
  const online = onlineBatchWords((rows ?? []).map((row) => row.name));
  const lookUpOnline = () =>
    mutation.run('online', async () => {
      try {
        const result = await api.pronunciationOnlineLookupBatch(online.words, online.words.length);
        const counts = `${result.fetched} looked up, ${result.fromCache} already on this computer, ${result.notFound} not in the dictionary`;
        if (result.stopped) notify(`Stopped after ${result.fetched + result.fromCache} of ${result.words}: ${result.stopReason}`, 'error');
        else notify(`Merriam-Webster: ${counts}. Open a name's pronunciation details to use an answer.`);
      } catch (error) {
        notify(describeApiError(error), 'error');
      } finally {
        setConfirmOnline(false);
      }
    });

  const shown = (rows ?? []).filter((row) => filter === 'open' || row.status === filter);
  const sent = (rows ?? []).filter((row) => row.status === 'query_sent').length;

  return (
    <SlideOver open={open} title="Pronunciation queries" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Every name the author has not confirmed yet. Export them to send to the author, then mark each one answered when you hear back.
        </p>
        {loadError && (
          <p role="alert" className="text-sm text-[var(--danger-text)]">
            {loadError}
          </p>
        )}
        {rows && (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]">Show</div>
              <Select
                label="Show queries"
                value={filter}
                onChange={(next) => setFilter(FILTERS.find((row) => row.value === next)?.value ?? 'open')}
                options={FILTERS}
              />
            </div>
            <div className="flex items-center gap-3">
              <span role="status" className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {rows.length} open · {sent} sent
              </span>
              <Button variant="ghost" disabled={online.words.length === 0 || mutation.isBusy} onClick={() => setConfirmOnline(true)}>
                Look up online…
              </Button>
              <Button disabled={rows.length === 0 || mutation.isBusy} pending={mutation.isPending('export')} onClick={() => void exportCsv()}>
                Export CSV
              </Button>
            </div>
          </div>
        )}
        {rows && rows.length === 0 && <p className="text-sm">Every pronunciation is confirmed by the author. Nothing to ask.</p>}
        {rows && rows.length > 0 && shown.length === 0 && <p className="text-sm">No query has this status.</p>}
        {shown.length > 0 && (
          <ul aria-label="Pronunciation queries" className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {shown.map((row) => {
              const status = pronunciationStatusInfo(row);
              const key = queryKey(row);
              return (
                <li key={key} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-semibold">{row.name}</span>
                      {row.aliasIndex !== null && <span className="ml-1.5 text-xs text-[var(--text-muted)]">alias of {row.entry}</span>}
                    </div>
                    <StatusBadge tone={status.tone} label={status.label} />
                  </div>
                  <p className="text-sm">
                    <span className="font-['IBM_Plex_Mono',ui-monospace,monospace]">{row.ipa || 'Not generated'}</span>
                    {row.ipa && <span className="text-xs text-[var(--text-muted)]"> · {pronunciationSourceLabel(row)}</span>}
                  </p>
                  {row.chapter ? (
                    <p className="text-xs break-words text-[var(--text-muted)]">
                      {row.chapter}: {row.excerpt}
                    </p>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)]">Not found in the manuscript.</p>
                  )}
                  {row.note && <p className="text-xs break-words">{row.note}</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {row.status === 'researched' && (
                      <Button
                        variant="ghost"
                        disabled={mutation.isBusy}
                        pending={mutation.isPending(`query_sent:${key}`)}
                        onClick={() => void setStatus(row, 'query_sent', `${row.name}: marked as sent.`)}
                        aria-label={`Mark ${row.name} as sent`}
                      >
                        Mark sent
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      disabled={mutation.isBusy}
                      pending={mutation.isPending(`author_confirmed:${key}`)}
                      onClick={() => void setStatus(row, 'author_confirmed', `${row.name}: marked as answered.`)}
                      aria-label={`Mark ${row.name} as answered`}
                    >
                      Mark answered
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {confirmOnline && (
        <ConfirmDialog
          title={`Look up ${online.words.length} ${online.words.length === 1 ? 'name' : 'names'} online?`}
          body={
            <>
              Merriam-Webster is sent each of these {online.words.length} {online.words.length === 1 ? 'name' : 'names'} on its own, on your own key, and
              nothing else from your book. Answers are kept on this computer; a name looked up before is not sent again.
              {online.leftOut > 0 &&
                ` ${online.leftOut} ${online.leftOut === 1 ? 'name is' : 'names are'} longer than three words or has symbols, and is left out.`}
            </>
          }
          confirmLabel={`Look up ${online.words.length}`}
          confirm={() => void lookUpOnline()}
          cancel={() => setConfirmOnline(false)}
          pending={mutation.isPending('online')}
        />
      )}
    </SlideOver>
  );
}
