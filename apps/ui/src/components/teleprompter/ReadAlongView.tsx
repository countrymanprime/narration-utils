import type { ReactNode } from 'react';
import { AssetFacts } from '../assets/AssetFacts';
import { AssetInstallPrompt } from '../assets/AssetInstallPrompt';
import { Panel } from '../primitives/Panel';
import { ReaderKey } from './ReaderKey';
import { ReaderText } from './ReaderText';
import type { ReaderMark } from './readerModel';
import type { FollowCursor } from './useFollowCursor';
import { ENGINE_LABELS, type TeleprompterSession } from './useTeleprompterSession';

type Props = {
  session: TeleprompterSession;
  /**
   * Following for the shared reader (engines-and-input-devices.prd.md Phase 10): computed by the caller and shared with
   * `ReadingControlBar`'s Follow button (read-aloud-control-bar.prd.md Phase 3), which now lives outside this view (the
   * dialog's non-scrolling footer, or the standalone page's own sticky bar).
   */
  follow: FollowCursor;
  /**
   * Rendered first in the text column, on the text's own axis (read-aloud-control-bar.prd.md Phase 1): the read-aloud
   * dialog's resume card. Absent when there is nothing to show (a running session, or credits mode).
   */
  header?: ReactNode;
  /** Story bible, note and flag marks by row key, and what opening one does (teleprompter-manuscript-integration.prd.md Phases 5 and 7; see `ReaderText`). */
  marks?: Map<string, ReaderMark[]>;
  onOpenMark?: (mark: ReaderMark) => void;
  /**
   * A side rail beside the text (the read-aloud dialog's Key, Notes and Story bible tabs, Phase 5). It sizes itself; the
   * key then lives in the rail instead of above the text. Absent (the standalone page): the layout is as before.
   */
  aside?: ReactNode;
};

/**
 * The reader text, status line and model-download prompt - everything a reading session shows once a chapter is chosen.
 * Shared by `TeleprompterPage` and `ReadAloudDialog` (teleprompter-manuscript-integration.prd.md Phase 2) so both mount
 * one view until the standalone page is retired (Phase 13). Chapter choice is not this component's job, and neither -
 * since read-aloud-control-bar.prd.md Phase 3 - is Start/Stop, the microphone or the engine/model choice: those moved
 * into `ReadingControlBar`, which the caller renders outside this view (a `Dialog` footer, or the page's own sticky bar).
 */
export function ReadAlongView({ session: t, follow, header, marks, onOpenMark, aside }: Props) {
  const main = (
    <div className="mx-auto w-full max-w-3xl min-w-0 space-y-4">
      {header}
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
              follow={t.active && follow.following}
              readerRef={follow.readerRef}
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
  // The rail is its own column, so opening an entry in an open rail never reflows or scrolls the text column. `h-full` gives
  // this grid the dialog body's own (definite, flexbox-computed) height, and `md:grid-rows-[minmax(0,1fr)]` makes the single
  // row match that height rather than the tallest item's content height, so `md:items-stretch` stretches the rail to exactly
  // the visible body, top to bottom, whatever the chapter's length (read-aloud-control-bar.prd.md Phase 1). The text column's
  // own content still overflows it normally; only the rail's box is bounded, sticky and scrolls on its own.
  return (
    <div className="grid h-full items-start gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:grid-rows-[minmax(0,1fr)] md:items-stretch">
      {main}
      {aside}
    </div>
  );
}
