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
  /**
   * Booth mode (booth-mode-and-companion-panel.prd.md Phase 1): the rail lives in `FocusShell`'s own landmark instead
   * of this view's grid (so `aside` stays unset, keeping this view to its bare `main` column), but the inline `ReaderKey`
   * above the text must still give way to the rail's own Key tab, the same as it does when `aside` is set.
   */
  hideKey?: boolean;
  /**
   * The Booth's reading surface (mock 03, audit BO3): the text straight on the page, full-bleed and large, with no bordered
   * card around it. The companion panel keeps the card (its own mock 07).
   */
  fullBleed?: boolean;
  /** Speaker tags by row key (the Booth's gutter, audit BO4; see `ReaderText`). */
  speakers?: Map<string, string>;
};

/**
 * The reader text, status line and model-download prompt - everything a reading session shows once a chapter is chosen.
 * Mounted by `BoothView` (the Booth, stage-navigation-and-page-replacement.prd.md Phase 4, which replaced the Teleprompter page
 * and the Read aloud dialog that shared it) and by `CompanionShell`. Chapter choice is not this component's job, and neither -
 * since read-aloud-control-bar.prd.md Phase 3 - is Start/Stop, the microphone or the engine/model choice: those moved
 * into `ReadingControlBar`, which the caller renders outside this view (a `Dialog` footer, or the page's own sticky bar).
 */
export function ReadAlongView({ session: t, follow, header, marks, onOpenMark, aside, hideKey = false, fullBleed = false, speakers }: Props) {
  const text = (
    <ReaderText
      rows={t.rows}
      cursor={t.cursor}
      skipped={t.session.skipped}
      follow={t.active && follow.following}
      readerRef={follow.readerRef}
      onSeek={t.active ? t.seek : undefined}
      marks={marks}
      onOpenMark={onOpenMark}
      speakers={speakers}
      large={fullBleed}
    />
  );
  const main = (
    <div className={`mx-auto w-full min-w-0 space-y-4 ${fullBleed ? 'max-w-5xl' : 'max-w-3xl'}`}>
      {header}
      {(t.error || t.host.phase === 'error') && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          {t.error || t.host.message}
        </p>
      )}
      {t.rows.length > 0 &&
        (fullBleed ? (
          <div className="px-1 py-2 md:px-4">{text}</div>
        ) : (
          <Panel>
            {!aside && !hideKey && <ReaderKey seekable={t.active} />}
            <div className={aside || hideKey ? '' : 'mt-3'}>{text}</div>
          </Panel>
        ))}
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
