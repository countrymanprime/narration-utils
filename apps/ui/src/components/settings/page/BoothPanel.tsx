import { useRef, useState } from 'react';
import { useAssetInstall } from '../../../hooks/useAssetInstall';
import { usePort } from '../../../ports/usePort';
import type { AssetInstallJob, AssetItem } from '../../../types';
import { AssetFacts } from '../../assets/AssetFacts';
import { AssetInstallPrompt } from '../../assets/AssetInstallPrompt';
import type { Notify } from '../../primitives/Toast';
import { ScopedFieldsPanel } from './ScopedFieldsPanel';

const ENGINE_LABEL: Record<string, string> = { whisper: 'Whisper', moonshine: 'Moonshine' };

/**
 * The Booth panel (the microphone, the live engine and its model). Choosing an engine or a model whose files are not on this computer
 * asks for the download at once, not when Record is first pressed; closing the question without a download puts the choice back.
 */
export function BoothPanel({ notify }: { notify: Notify }) {
  const assets = usePort('assets');
  const [asset, setAsset] = useState<AssetItem>();
  // What puts the choice back when the question is closed without a download.
  const revert = useRef<(() => void) | null>(null);
  const install = useAssetInstall<AssetInstallJob>({
    start: () => (asset ? assets.assetsInstall(asset.kind, asset.id) : Promise.reject(new Error('Choose a model first.'))),
    state: (jobId) => assets.assetsInstallState(jobId),
    cancel: (jobId) => assets.assetsInstallCancel(jobId),
    onSuccess: () => {
      revert.current = null;
      setAsset(undefined);
      notify('Model installed.');
    },
  });

  const choose = (change: { key: string; values: Record<string, string>; revert: () => void }) => {
    if (change.key !== 'engine' && change.key !== 'model') return;
    // A field with no value of its own runs on the host's default (Whisper tiny), the same one a session starts with.
    const engine = change.values['engine'] || 'whisper';
    const model = change.values['model'] || 'tiny';
    if (!ENGINE_LABEL[engine]) return;
    void assets
      .assetsList()
      .then((catalog) => {
        const found = catalog.assets.find((item) => item.kind === engine && item.id === model);
        if (!found || found.installState === 'installed') return;
        revert.current = change.revert;
        install.reset();
        setAsset(found);
      })
      .catch(() => {
        // The list could not be read: nothing is claimed, and Record asks again before it starts.
      });
  };
  const dismiss = () => {
    revert.current?.();
    revert.current = null;
    setAsset(undefined);
    install.reset();
  };
  const label = asset ? (ENGINE_LABEL[asset.kind] ?? asset.kind) : '';

  return (
    <ScopedFieldsPanel
      id="booth"
      title="Booth"
      tool="Teleprompter"
      scopes={['global']}
      notify={notify}
      onChoose={choose}
      after={() =>
        asset && (
          <AssetInstallPrompt
            ask={{
              title: `Download local ${label} model?`,
              body: `The ${asset.displayName} ${label} model listens for your voice. It is not bundled with Narration Studio and will be stored in your per-user asset cache. Closing this puts the engine back.`,
              confirmLabel: 'Download model',
            }}
            workTitle={`Downloading ${label} model`}
            install={install}
            dismiss={dismiss}
          >
            <AssetFacts
              label="Model"
              name={asset.displayName}
              version={asset.version}
              publisher={asset.publisher}
              license={asset.license}
              licenseUrl={asset.licenseUrl}
              modelCardUrl={asset.modelCardUrl}
              provenanceUrl={asset.provenanceUrl}
              downloadSize={asset.downloadSize}
              diskSize={asset.diskSize}
              installPath={asset.path}
            />
          </AssetInstallPrompt>
        )
      }
    />
  );
}
