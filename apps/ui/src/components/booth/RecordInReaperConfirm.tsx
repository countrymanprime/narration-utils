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
  return (
    <ConfirmDialog
      title="Record in REAPER?"
      body={`Play will arm and start recording on the track linked to "${chapterTitle}", and Stop will stop it. Nothing on any other track is affected. You can turn this off again from the same toggle.`}
      confirmLabel="Turn on"
      confirm={confirm}
      cancel={cancel}
    />
  );
}
