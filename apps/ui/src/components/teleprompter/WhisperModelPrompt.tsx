import { AssetFacts } from '../assets/AssetFacts';
import { AssetInstallPrompt } from '../assets/AssetInstallPrompt';
import type { AssetInstall } from '../../hooks/useAssetInstall';
import type { ModelPrompt } from './useTeleprompterSession';

/**
 * The Whisper model's first-use question and download (the shared `AssetInstallPrompt`), for a teleprompter action that
 * found the model missing: nothing is downloaded until the narrator confirms. `purpose` says what the model is needed for.
 */
export function WhisperModelPrompt({
  prompt,
  purpose,
  install,
  dismiss,
}: {
  prompt: ModelPrompt;
  purpose: string;
  install: AssetInstall;
  dismiss: () => void;
}) {
  return (
    <AssetInstallPrompt
      ask={{
        title: 'Download local Whisper model?',
        body: `The ${prompt.model.displayName} Whisper model ${purpose}. It is not bundled with Narration Utils and will be stored in your per-user asset cache.`,
        confirmLabel: 'Download model',
      }}
      workTitle="Downloading Whisper model"
      install={install}
      dismiss={dismiss}
    >
      <AssetFacts
        label="Model"
        name={prompt.model.displayName}
        version={prompt.model.version}
        publisher={prompt.model.publisher}
        license={prompt.model.license}
        licenseUrl={prompt.model.licenseUrl}
        modelCardUrl={prompt.model.modelCardUrl}
        provenanceUrl={prompt.model.provenanceUrl}
        downloadSize={prompt.downloadSize}
        diskSize={prompt.diskSize}
        installPath={prompt.installPath}
      />
    </AssetInstallPrompt>
  );
}
