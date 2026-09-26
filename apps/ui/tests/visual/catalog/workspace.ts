// The `workspace` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';

export const workspaceStates: StateEntry[] = [
  // Chapter workspace (edit-and-proof-workspace.prd.md Phase 2): a chapter route under Tracks, reached from a
  // linked chapter's "Open workspace" link (captured on the Tracks and Home rows above, not repeated here).
  {
    page: 'workspace',
    state: 'never',
    description:
      'Chapter workspace, a chapter with a confirmed track link that has never been checked - "hasn’t been checked yet", Check recording, no player or script yet',
  },
  {
    page: 'workspace',
    state: 'stale',
    description:
      'Chapter workspace, a stale check (an item was trimmed since) - "Check stale" state pill, the script and player still shown from the last check',
  },
  {
    page: 'workspace',
    state: 'current',
    description:
      'Chapter workspace, a current check - header, transport, script with its flags struck through/underlined in place, and the Flags panel with its legend',
  },
  {
    page: 'workspace',
    state: 'playing',
    description: 'Chapter workspace, Play pressed - transport shows Pause and a live elapsed readout, the currently spoken word highlighted in the script',
  },
  {
    page: 'workspace',
    state: 'flag-selected',
    description: 'Chapter workspace, a flag selected from the Flags panel - its script/heard text and "Play from here" shown in the panel’s detail section',
  },
  {
    page: 'workspace',
    state: 'standalone',
    description:
      'Chapter workspace with REAPER not running - everything here still works (Phase 2 has no REAPER-driven control yet: Go to/Loop are Phase 3), so this is the same page as "current"',
    sameAs: {
      of: 'workspace/current',
      reason:
        'Phase 2 adds no REAPER-driven control (Go to, Loop are Phase 3), so nothing on this page changes whether or not REAPER is running; the header’s REAPER pill is AppShell’s own, shown on every page.',
    },
  },
];
