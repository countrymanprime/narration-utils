import { useCallback, useMemo, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { usePendingAction } from '../../hooks/usePendingAction';
import { useReaperStatus } from '../review/useReaperStatus';
import type { WorkspaceToken } from '../../api/contracts/workspace';

// Why a control is off when the current word cannot be placed - the host refuses the same words in the same words
// (apps/desktop/bindings_workspace.go), so a button is never enabled for a request that can only be refused.
const NO_TOKEN = 'Nothing is playing yet.';
const NO_ITEM = "This word wasn't heard in the recording, so there's nothing to go to. Run the check again if the chapter has changed.";
const NO_SOURCE_TIME = 'This word has no time in its audio to loop. Go to it instead.';
const CHECKING = 'Checking whether REAPER is connected…';

export type WorkspaceReaperControls = {
  /** Why Go to is disabled, or undefined when it can be pressed. */
  goToBlocked: string | undefined;
  /** Why Loop is disabled, or undefined when it can be pressed. */
  loopBlocked: string | undefined;
  /** Whether this transport's own loop is the one playing in REAPER (Stop loop replaces Loop while true). */
  looping: boolean;
  /** Which control is mid-request, or undefined when none is. */
  pending: 'goTo' | 'loop' | 'stop' | undefined;
  /** What REAPER refused, or a request that could not be asked at all, in plain words for an alert. */
  message: string | undefined;
  goTo: () => Promise<void>;
  loop: () => Promise<void>;
  stopLoop: () => Promise<void>;
  /** Why Go to/Loop is disabled for an arbitrary token (a selected flag, not necessarily the playhead's word),
   * mockups/edit-and-proof-workspace/02-flag-detail-open.webp's flag detail "GO TO"/"LOOP": the same reasons as
   * `goToBlocked`/`loopBlocked`, computed for `tokenIndex` instead of the current one. */
  goToTokenBlocked: (tokenIndex: number) => string | undefined;
  loopTokenBlocked: (tokenIndex: number) => string | undefined;
  /** Which of these sends a flag's Go to/Loop, kept apart from `pending` so a flag's own buttons don't read as busy
   * while the transport bar sends the playhead's, or the other way round. */
  tokenPending: 'goTo' | 'loop' | undefined;
  goToToken: (tokenIndex: number) => Promise<void>;
  loopToken: (tokenIndex: number) => Promise<void>;
};

/**
 * Go to and Loop in REAPER for the workspace's transport bar (edit-and-proof-workspace.prd.md Phase 3): the word
 * currently at the playhead (`currentToken`, an index into `tokens`) is sent to `workspaceGoTo`/`workspaceLoop` as a
 * token index - the host resolves it to an item, take and source time from the chapter's stored alignment checked
 * against the saved project, never the page (`docs/architecture/reaper-navigation.md`, "From the workspace").
 * Connection status is shared with the Review page (`useReaperStatus`, `findingsReaperStatus`): the same heartbeat,
 * the same poll. Stop loop calls `findingsStopLoop`, which stops whichever app loop is held, workspace or finding.
 * `looping` reads `status.loopingFindingId` (set to `workspace:<chapterId>:<first>-<last>` by `WorkspaceLoop`,
 * bindings_workspace.go) rather than local state, so it survives a poll after the narrator leaves the page and
 * comes back, exactly as the Review page's own looping finding does.
 */
export function useWorkspaceReaper(chapterId: string, currentToken: number | undefined, tokens: WorkspaceToken[]): WorkspaceReaperControls {
  const api = useApi();
  const action = usePendingAction();
  const tokenAction = usePendingAction();
  const reaper = useReaperStatus();
  const [message, setMessage] = useState<string>();
  const looping = useMemo(
    () => reaper.status?.connection === 'connected' && (reaper.status.loopingFindingId?.startsWith(`workspace:${chapterId}:`) ?? false),
    [reaper.status, chapterId],
  );

  const token = currentToken === undefined ? undefined : tokens.find((candidate) => candidate.i === currentToken);
  const connected = reaper.status?.connection === 'connected';
  const connectionReason = reaper.status === undefined ? CHECKING : connected ? undefined : reaper.status.message;
  const noItem = token !== undefined && token.item === undefined ? NO_ITEM : undefined;
  const goToBlocked = (currentToken === undefined ? NO_TOKEN : undefined) ?? noItem ?? connectionReason;
  const loopBlocked =
    (currentToken === undefined ? NO_TOKEN : undefined) ?? noItem ?? (token?.end === undefined ? NO_SOURCE_TIME : undefined) ?? connectionReason;

  const sendVia = useCallback(
    (runner: typeof action, key: string, request: () => Promise<{ outcome: string; message?: string }>) =>
      runner.run(key, async () => {
        setMessage(undefined);
        try {
          const result = await request();
          if (result.outcome === 'refused') setMessage(result.message);
        } catch (error) {
          setMessage(`REAPER was not asked: ${apiErrorMessage(error)}`);
        }
        await reaper.refresh();
      }),
    [reaper],
  );
  const send = useCallback(
    (key: 'goTo' | 'loop' | 'stop', request: () => Promise<{ outcome: string; message?: string }>) => sendVia(action, key, request),
    [action, sendVia],
  );

  const blockedFor = useCallback(
    (tokenIndex: number, needsSourceTime: boolean): string | undefined => {
      const candidate = tokens.find((entry) => entry.i === tokenIndex);
      const itemMissing = candidate !== undefined && candidate.item === undefined ? NO_ITEM : undefined;
      return itemMissing ?? (needsSourceTime && candidate?.end === undefined ? NO_SOURCE_TIME : undefined) ?? connectionReason;
    },
    [tokens, connectionReason],
  );

  return {
    goToBlocked,
    loopBlocked,
    looping,
    pending: action.isPending('goTo') ? 'goTo' : action.isPending('loop') ? 'loop' : action.isPending('stop') ? 'stop' : undefined,
    message,
    goTo: async () => {
      if (currentToken === undefined) return;
      await send('goTo', () => api.workspaceGoTo(chapterId, currentToken));
    },
    loop: async () => {
      if (currentToken === undefined) return;
      await send('loop', () => api.workspaceLoop(chapterId, currentToken, currentToken));
    },
    stopLoop: async () => {
      await send('stop', () => api.findingsStopLoop());
    },
    goToTokenBlocked: (tokenIndex) => blockedFor(tokenIndex, false),
    loopTokenBlocked: (tokenIndex) => blockedFor(tokenIndex, true),
    tokenPending: tokenAction.isPending('goTo') ? 'goTo' : tokenAction.isPending('loop') ? 'loop' : undefined,
    goToToken: async (tokenIndex) => {
      await sendVia(tokenAction, 'goTo', () => api.workspaceGoTo(chapterId, tokenIndex));
    },
    loopToken: async (tokenIndex) => {
      await sendVia(tokenAction, 'loop', () => api.workspaceLoop(chapterId, tokenIndex, tokenIndex));
    },
  };
}
