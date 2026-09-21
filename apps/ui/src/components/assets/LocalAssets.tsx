import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { AssetCatalog } from '../../types';
import { Button } from '../primitives/Button';
import type { Notify } from '../primitives/Toast';
import { formatSize } from './AssetFacts';
import { LocalAssetRow } from './LocalAssetRow';

/**
 * Settings > Local assets: every optional download the app can keep on this computer (voices, Whisper models, Story Bible language models) in
 * one list, with what each is, whether it is installed, and the actions that fit: Download, Verify, Repair, Remove. The list comes from
 * `assetsList`, which reads each asset's manifest and nothing else, so it opens at once; only Verify reads the files.
 *
 * The folder is shown and never changed or emptied from here (owner decision Q3): removing is per asset, after a confirm.
 */
export function LocalAssets({ notify }: { notify: Notify }) {
  const api = useApi();
  const [catalog, setCatalog] = useState<AssetCatalog>();
  const [loadError, setLoadError] = useState('');

  // Every row reloads the list when it changes, so two answers can be in flight: only the newest one is shown.
  const latestLoad = useRef(0);
  // Keeps the list on screen while it reloads, so a row (and the download it follows) is never torn down by a refresh.
  const load = useCallback(async () => {
    const mine = ++latestLoad.current;
    try {
      const next = await api.assetsList();
      if (mine !== latestLoad.current) return;
      setCatalog(next);
      setLoadError('');
    } catch (error) {
      if (mine === latestLoad.current) setLoadError(apiErrorMessage(error));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 text-sm">
      <p style={{ color: 'var(--text-muted)' }}>
        Voices and models are optional downloads kept on this computer. Nothing downloads until you choose it here or confirm it when a feature asks; removing
        one never touches your settings or projects.
      </p>
      {loadError && (
        <div className="space-y-2 rounded-md p-3" role="alert" style={{ background: 'var(--review-soft)', color: 'var(--danger-text)' }}>
          <p>The local assets could not be listed: {loadError}</p>
          <Button variant="ghost" className="text-xs" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}
      {catalog && (
        <>
          <div className="space-y-1 rounded-md p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="font-medium">
              {catalog.totalInstalledBytes > 0 ? `Installed assets use ${formatSize(catalog.totalInstalledBytes)} of disk` : 'No assets are installed'}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Kept in <code className="break-all">{catalog.cacheRoot}</code>
            </div>
          </div>
          <ul className="space-y-3" aria-label="Local assets">
            {catalog.assets.map((item) => (
              <LocalAssetRow key={`${item.kind}/${item.id}`} item={item} onChanged={load} notify={notify} />
            ))}
          </ul>
        </>
      )}
      {!catalog && !loadError && (
        <p role="status" style={{ color: 'var(--text-muted)' }}>
          Loading local assets…
        </p>
      )}
    </div>
  );
}
