import { CommandRouter, type CommandRouterProps } from './router';
import { useDawRecording } from './useDawRecording';

export type LiveCommandRouterProps = Omit<CommandRouterProps, 'isRecording'>;

/**
 * Mounted at the root in place of a bare `<CommandRouter>` (main.tsx, input-commands-and-pedals.prd.md Phase 10):
 * wires the router's `isRecording` seam (Phase 1) to the DAW port's live transport state, so a `noisy` command
 * actually goes silent while REAPER reports recording. Needs an `<ApiProvider>` ancestor, which `<CommandRouter>`
 * itself does not - tests that don't care about the DAW port keep using `<CommandRouter>` directly, as `router.test.tsx`
 * does.
 */
export function LiveCommandRouter({ children, ...props }: LiveCommandRouterProps) {
  const isRecording = useDawRecording();
  return (
    <CommandRouter {...props} isRecording={isRecording}>
      {children}
    </CommandRouter>
  );
}
