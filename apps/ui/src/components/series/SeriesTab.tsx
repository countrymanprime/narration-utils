import { useCallback, useEffect, useState } from 'react';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { Series, SeriesVoiceBible } from '../../types';
import { formatRegionTime } from '../storybible/VoiceReferencesSection';
import { Button } from '../primitives/Button';
import { InsetCard } from '../primitives/InsetCard';
import { StatusBadge } from '../primitives/StatusBadge';
import { TextField } from '../primitives/TextField';
import type { Notify } from '../primitives/Toast';

/**
 * The Series tab of the Story Bible (character-continuity-review.prd.md Phase 11, D79: a tab, no nav entry of its
 * own). Non-acoustic only (owner decision D87 on #509 benches the acoustic engine): characters shared across the
 * series' member projects, their approved reference clips and which book each came from - reusing Phase 6's
 * reference-versus-candidate clip listing (VoiceReferencesSection.tsx's `formatRegionTime`; there is no audition to
 * reuse yet, since no binding plays audio in-app and no drift comparison exists while the acoustic engine is
 * benched). Per-book drift evidence (Phase 10) has no data source while that engine is benched, so it is left out
 * here entirely - see the PRD's Phase 11 status cell.
 */
export function SeriesTab({ notify }: { notify: Notify }) {
  const api = useApi();
  const mutation = usePendingAction();
  const [bible, setBible] = useState<SeriesVoiceBible>();
  const [loadError, setLoadError] = useState<string>();
  const [seriesList, setSeriesList] = useState<Series[]>();
  const [newBookPath, setNewBookPath] = useState('');
  const [seriesName, setSeriesName] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextBible, nextList] = await Promise.all([api.seriesVoiceBible(), api.seriesList()]);
      setBible(nextBible);
      setSeriesList(nextList);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeApiError(error));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const currentSeries = bible?.seriesId ? seriesList?.find((series) => series.id === bible.seriesId) : undefined;

  const createSeries = () =>
    mutation.run('create', async () => {
      const name = seriesName.trim();
      if (!name) return;
      try {
        await api.seriesSave('', name, []);
        setSeriesName('');
        notify('Series created.');
        await load();
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  const browseForBook = () =>
    mutation.run('browse', async () => {
      try {
        const selection = await api.selectProjectFolder();
        if (selection.selected && selection.path) setNewBookPath(selection.path);
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  const addBook = () =>
    mutation.run('add-book', async () => {
      const path = newBookPath.trim();
      if (!path || !currentSeries) return;
      try {
        const members = [...new Set([...currentSeries.memberProjectPaths, path])];
        await api.seriesSave(currentSeries.id, currentSeries.name, members);
        setNewBookPath('');
        notify('Book added to the series.');
        await load();
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  const removeBook = (path: string) =>
    mutation.run(`remove:${path}`, async () => {
      if (!currentSeries) return;
      try {
        const members = currentSeries.memberProjectPaths.filter((member) => member !== path);
        await api.seriesSave(currentSeries.id, currentSeries.name, members);
        notify('Book removed from the series.');
        await load();
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  if (loadError)
    return (
      <p className="p-4 text-sm" style={{ color: 'var(--danger-text)' }}>
        {loadError}
      </p>
    );
  if (!bible) return null;

  if (!bible.inSeries) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No other books in this series yet. Name a series to start sharing this project's approved character references with the other books it belongs to.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="Series name" value={seriesName} onChange={setSeriesName} placeholder="e.g. Wonderland" />
          <Button variant="ghost" size="sm" disabled={!seriesName.trim()} pending={mutation.isPending('create')} onClick={() => void createSeries()}>
            Create series
          </Button>
        </div>
      </div>
    );
  }

  const members = currentSeries?.memberProjectPaths ?? [];

  return (
    <div className="space-y-4 overflow-y-auto p-4">
      <div>
        <div className="text-sm font-medium">{bible.seriesName}</div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {bible.bookCount} book{bible.bookCount === 1 ? '' : 's'}
        </div>
      </div>

      {bible.bookCount <= 1 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No other books in this series yet.
        </p>
      ) : (
        (bible.characters ?? []).map((character) => (
          <InsetCard key={character.characterId}>
            <div className="mb-1.5 text-sm font-medium">{character.name}</div>
            <ul className="space-y-1.5">
              {character.clips.map((clip) => (
                <InsetCard as="li" key={clip.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{clip.name}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {clip.book} · {formatRegionTime(clip.start)}–{formatRegionTime(clip.end)}
                      {clip.note ? ` · ${clip.note}` : ''}
                    </div>
                  </div>
                  {clip.isCurrentProject && <StatusBadge tone="neutral" label="This book" />}
                  {clip.changedSinceApproval && <StatusBadge tone="warning" label="Changed since approval" />}
                </InsetCard>
              ))}
            </ul>
          </InsetCard>
        ))
      )}

      {bible.unreadableBooks && bible.unreadableBooks.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--danger-text)' }}>
          Could not read {bible.unreadableBooks.join(', ')}.
        </p>
      )}

      {currentSeries && (
        <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            Books in this series
          </div>
          <ul className="space-y-1">
            {members.map((path) => (
              <li key={path} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{path}</span>
                <Button variant="ghost" size="sm" pending={mutation.isPending(`remove:${path}`)} onClick={() => void removeBook(path)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="Add a book" value={newBookPath} onChange={setNewBookPath} placeholder="Project folder" />
            <Button variant="ghost" size="sm" pending={mutation.isPending('browse')} onClick={() => void browseForBook()}>
              Browse…
            </Button>
            <Button variant="ghost" size="sm" disabled={!newBookPath.trim()} pending={mutation.isPending('add-book')} onClick={() => void addBook()}>
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
