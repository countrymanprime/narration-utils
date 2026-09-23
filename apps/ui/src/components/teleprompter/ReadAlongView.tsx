import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faStop } from '@fortawesome/free-solid-svg-icons';
import { AssetFacts } from '../assets/AssetFacts';
import { AssetInstallPrompt } from '../assets/AssetInstallPrompt';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { TooltipTarget } from '../primitives/Tooltip';
import { MicrophoneField } from './MicrophoneField';
import { ReaderText } from './ReaderText';
import { MODELS, type TeleprompterSession } from './useTeleprompterSession';

const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';

// The legend for every mark the reader can show (Solution Detail, "Key and flag marks"). Phase 2 covers only the
// three marks that already exist on the page today (`ReaderText.tsx`); the flag marks (misread, extra, skipped-as-a-
// review-item) are Phase 7's. The swatches copy `ReaderText`'s own styling by hand rather than rendering a real
// `Highlight`/`data-word`, so this legend is never mistaken for the actual current word by a `[data-highlight="Cursor"]`
// or `[data-word]` query (the reader's own tests and the mock-driven visual states rely on those being unique).
function ReaderKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }} aria-label="Key">
      <span className="font-medium">Key:</span>
      <span className="flex items-center gap-1.5">
        <span className="rounded-[0.15rem] px-[0.05em]" style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}>
          word
        </span>{' '}
        current word
      </span>
      <span className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
        word read
      </span>
      <span className="flex items-center gap-1.5">
        <span style={{ textDecoration: 'underline dotted var(--warn)', textUnderlineOffset: '0.25em' }}>word</span> skipped
      </span>
    </div>
  );
}

type Props = {
  session: TeleprompterSession;
  /** Extra setup fields shown above the microphone/model row while idle (the standalone page's chapter picker). */
  extraSetupFields?: ReactNode;
};

/**
 * The setup fields (while idle), status bar, Start/Stop, reader text and model-download prompt - everything a reading
 * session shows once a chapter is chosen. Shared by `TeleprompterPage` and `ReadAloudDialog`
 * (teleprompter-manuscript-integration.prd.md Phase 2) so both mount one view until the standalone page is retired
 * (Phase 13). Chapter choice itself is not this component's job: the caller supplies `extraSetupFields` for it (or
 * nothing, when the chapter is fixed, as in the modal).
 */
export function ReadAlongView({ session: t, extraSetupFields }: Props) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className={t.active ? 'sticky top-0 z-10' : ''}>
        <Panel>
          {!t.active && (
            <div className="grid gap-4 md:grid-cols-2">
              {extraSetupFields}
              <MicrophoneField
                value={t.device}
                onChange={t.changeDevice}
                devices={t.devices}
                error={t.devicesError}
                onRefresh={t.loadDevices}
                refreshing={t.devicesLoading}
              />
              <div className="md:col-span-2">
                <span className={LABEL_CLASS}>Whisper model</span>
                <ToggleGroup
                  label="Whisper model"
                  className="mt-1.5 flex-wrap gap-1.5"
                  value={t.model}
                  onChange={t.setModel}
                  options={MODELS.map((option) => ({ value: option.value, label: option.label, title: option.caption }))}
                />
              </div>
            </div>
          )}
          <div className={`flex flex-wrap items-center justify-between gap-3 ${t.active ? '' : 'mt-4'}`}>
            <div className="min-w-0 text-sm">
              <span
                role="status"
                className="font-semibold"
                style={{ color: t.session.position?.status === 'waiting' && t.active ? 'var(--warn-text)' : undefined }}
              >
                {t.status}
              </span>
              {t.session.script && (
                <span className="ml-2 font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                  {t.session.cursor.toLocaleString()} of {t.session.script.tokens.toLocaleString()} words
                </span>
              )}
              {t.active && t.session.heard && (
                <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                  Heard: {t.session.heard}
                </div>
              )}
            </div>
            {t.active ? (
              <Button variant="danger" onClick={t.stop} disabled={t.host.phase === 'stopping'}>
                <FontAwesomeIcon icon={faStop} /> Stop
              </Button>
            ) : (
              <TooltipTarget text={t.startReason}>
                <Button onClick={() => void t.start()} disabled={!t.canStart}>
                  <FontAwesomeIcon icon={faMicrophone} /> Start reading
                </Button>
              </TooltipTarget>
            )}
          </div>
        </Panel>
      </div>
      {(t.error || t.host.phase === 'error') && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          {t.error || t.host.message}
        </p>
      )}
      {t.rows.length > 0 && (
        <Panel>
          <ReaderKey />
          <div className="mt-3">
            <ReaderText rows={t.rows} cursor={t.cursor} skipped={t.session.skipped} follow={t.active} />
          </div>
        </Panel>
      )}
      {t.prompt && (
        <AssetInstallPrompt
          ask={{
            title: 'Download local Whisper model?',
            body: `The ${t.prompt.model.displayName} Whisper model listens for your voice. It is not bundled with Narration Utils and will be stored in your per-user asset cache.`,
            confirmLabel: 'Download model',
          }}
          workTitle="Downloading Whisper model"
          install={t.modelInstall}
          dismiss={t.closeModelPrompt}
        >
          <AssetFacts
            label="Model"
            name={t.prompt.model.displayName}
            version={t.prompt.model.version}
            publisher={t.prompt.model.publisher}
            license={t.prompt.model.license}
            licenseUrl={t.prompt.model.licenseUrl}
            modelCardUrl={t.prompt.model.modelCardUrl}
            provenanceUrl={t.prompt.model.provenanceUrl}
            downloadSize={t.prompt.downloadSize}
            diskSize={t.prompt.diskSize}
            installPath={t.prompt.installPath}
          />
        </AssetInstallPrompt>
      )}
    </div>
  );
}
