import { useCallback, useRef, useState } from 'react';

/**
 * One action at a time for a group of controls (ADR 0075): `run(key, action)` starts the action and marks that key pending until it settles,
 * and while it runs every other `run` is refused, so two presses (or two different buttons that touch the same file) never overlap. The
 * generalization of `ProjectPicker.runAction`.
 *
 * The refusal is in the code path, not only in how a button looks: a second Enter key in the same tick reaches `run` before React has
 * re-rendered, so the guard is a ref. `run` resolves to what the action returned, or `undefined` when it was refused. The action owns its
 * own error handling (it decides where a failure is shown); if it throws anyway the key is still released.
 */
export function usePendingAction() {
  const [pendingKey, setPendingKey] = useState<string>();
  const running = useRef<string>(undefined);
  const run = useCallback(async <T>(key: string, action: () => Promise<T>): Promise<T | undefined> => {
    if (running.current !== undefined) return undefined;
    running.current = key;
    setPendingKey(key);
    try {
      return await action();
    } finally {
      running.current = undefined;
      setPendingKey(undefined);
    }
  }, []);
  return {
    run,
    /** True while the action started under this key is running. */
    isPending: (key: string) => pendingKey === key,
    /** True while any action is running. */
    isBusy: pendingKey !== undefined,
    /** True while an action other than this one is running: the controls of the others are disabled meanwhile. */
    isBlockedFor: (key: string) => pendingKey !== undefined && pendingKey !== key,
  };
}
