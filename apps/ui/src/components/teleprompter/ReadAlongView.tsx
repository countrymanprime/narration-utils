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
import { ReaderKey } from './ReaderKey';
import { ReaderText } from './ReaderText';
import type { ReaderMark } from './readerModel';
import { ENGINE_LABELS, MODELS, type TeleprompterSession } from './useTeleprompterSession';

const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';

type Props = {
  session: TeleprompterSession;
  /** Extra setup fields shown above the microphone/model row while idle (the standalone page's chapter picker). */
  extraSetupFields?: ReactNode;
  /** Story bible and note marks by row key, and what opening one does (teleprompter-manuscript-integration.prd.md Phase 5; see `ReaderText`). */
  marks?: Map<string, ReaderMark[]>;
  onOpenMark?: (mark: ReaderMark) => void;
  /**
   * A side rail beside the text (the read-aloud dialog's Key, Notes and Story bible tabs, Phase 5). It sizes itself; the
   * key then lives in the rail instead of above the text. Absent (the standalone page): the layout is as before.
   */
  aside?: ReactNode;
};

/**
 * The setup fields (while idle), status bar, Start/Stop, reader text and model-download prompt - everything a reading
 * session shows once a chapter is chosen. Shared by `TeleprompterPage` and `ReadAloudDialog`
 * (teleprompter-manuscript-integration.prd.md Phase 2) so both mount one view until the standalone page is retired
 * (Phase 13). Chapter choice itself is not this component's job: the caller supplies `extraSetupFields` for it (or
 * nothing, when the chapter is fixed, as in the modal).
 */
export function ReadAlongView({ session: t, extraSetupFields, marks, onOpenMark, aside }: Props) {
  const main = (
    <div className="mx-auto w-full max-w-3xl min-w-0 space-y-4">
      <div className={t.active ? 'sticky top-0 z-10' : ''}>
        <Panel>
          {!t.active && (
            // Beside a rail the column is narrower than the viewport says, so the fields pair up a breakpoint later.
            <div className={`grid gap-4 ${aside ? 'lg:grid-cols-2' : 'md:grid-cols-2'}`}>
              {extraSetupFields}
              <MicrophoneField
                value={t.device}
                onChange={t.changeDevice}
                devices={t.devices}
                error={t.devicesError}
                onRefresh={t.loadDevices}
                refreshing={t.devicesLoading}
              />
              {/* The engine choice shows only where the host can launch more than one (Moonshine ships on Windows only, ADR 0107). */}
              {t.engines.length > 1 && (
                <div>
                  <span className={LABEL_CLASS}>Engine</span>
                  <ToggleGroup label="Engine" className="mt-1.5 flex-wrap gap-1.5" value={t.engine} onChange={t.changeEngine} options={t.engines} />
                </div>
              )}
              <div className={t.engines.length > 1 ? '' : aside ? 'lg:col-span-2' : 'md:col-span-2'}>
                <span className={LABEL_CLASS}>{t.engines.length > 1 ? 'Model' : `${ENGINE_LABELS[t.engine]} model`}</span>
                <ToggleGroup
                  label="Model"
                  className="mt-1.5 flex-wrap gap-1.5"
                  value={t.model}
                  onChange={t.changeModel}
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
          {!aside && <ReaderKey seekable={t.active} />}
          <div className={aside ? '' : 'mt-3'}>
            <ReaderText
              rows={t.rows}
              cursor={t.cursor}
              skipped={t.session.skipped}
              follow={t.active}
              onSeek={t.active ? t.seek : undefined}
              marks={marks}
              onOpenMark={onOpenMark}
            />
          </div>
        </Panel>
      )}
      {t.prompt && (
        <AssetInstallPrompt
          ask={{
            title: `Download local ${ENGINE_LABELS[t.prompt.engine]} model?`,
            body: `The ${t.prompt.model.displayName} ${ENGINE_LABELS[t.prompt.engine]} model listens for your voice. It is not bundled with Narration Utils and will be stored in your per-user asset cache.`,
            confirmLabel: 'Download model',
          }}
          workTitle={`Downloading ${ENGINE_LABELS[t.prompt.engine]} model`}
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
  if (!aside) return main;
  // The rail is its own column, so opening an entry in an open rail never reflows or scrolls the text column.
  return (
    <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
      {main}
      {aside}
    </div>
  );
}
