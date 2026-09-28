import { ConfirmDialog } from '../primitives/ConfirmDialog';

type Props = {
  /** The chapter's display title (chapterName's full name), named in the confirm the way the reader already knows it. */
  chapterTitle: string;
  confirm: () => void;
  cancel: () => void;
};

/**
 * The first-time confirm turning Record in REAPER on for this project (read-aloud-control-bar.prd.md Phase 7, Q9;
 * booth-actions-enablement.prd.md Phase 2): shown once per project, the first time the toggle is turned on
 * (`ReadAloud.record_confirmed`). It names the chapter, not a REAPER track name the host never sends, and says
 * exactly what Play and Stop do so a narrator never wonders whether REAPER is recording by surprise.
 */
export function RecordInReaperConfirm({ chapterTitle, confirm, cancel }: Props) {
  // The title and the "never stopped" and "asked once" sentences are read-aloud-control-bar mock 05's own words. The first
  // sentence keeps to what Play and Stop do today: the mock's "Pause and Stop will stop that recording" waits for Pause
  // to stop REAPER too (Q8 Pause A, still to be checked in REAPER's scripted run), so it is not promised here.
  return (
    <ConfirmDialog
      title="Record in REAPER when you press Play?"
      body={
        <>
          <p>
            Play will arm and start recording in REAPER on the track linked to <strong>{chapterTitle}</strong>, and Stop will stop that recording.
          </p>
          <p className="mt-2">Nothing is recorded on any other track, and a recording you started in REAPER yourself is never stopped by the app.</p>
          <p className="mt-2">You will be asked this once for this project. You can turn it off from the bar at any time.</p>
        </>
      }
      confirmLabel="Turn on"
      confirm={confirm}
      cancel={cancel}
    />
  );
}
