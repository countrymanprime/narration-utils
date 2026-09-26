import type { ReactNode } from 'react';

export type FocusShellProps = {
  // Top bar: level, mic, take, connection state.
  status: ReactNode;
  statusLabel?: string;
  // Side panel: last punch, voices in scene, coming up, this session (mock 03). Omitted, or `railCollapsed`, and the
  // main region takes the freed width - the shell only lays out what it is given; a toggle control (and where its state
  // lives) is the feature's, not this primitive's (ADR 0360: layout only, no Escape or exit logic of its own).
  rail?: ReactNode;
  railLabel?: string;
  railCollapsed?: boolean;
  // Bottom bar: the command toolbar.
  commands: ReactNode;
  commandsLabel?: string;
  // The script / main content.
  children: ReactNode;
  className?: string;
};

// The full-screen booth layout (studio-ui-primitives.prd.md Phase 9): a status bar, an optional side rail, the main
// region and a command bar, each a named landmark so a screen reader can jump straight to any of them. It sets
// `data-surface="booth"` on its own root so the Phase 1 booth token block (`styles.css`) applies to everything drawn
// inside it, regardless of the narrator's light/dark preference - the booth is a place, not a preference (ADR 0360 Q1).
// A slots-only API: it composes whatever `ReactNode`s it is given and imports no other primitive, so it needs no change
// as `Kbd`, `StatusBadge`, `LevelMeter` and `Toolbar` land inside it. It is a route or sits in `Dialog size="full"` at
// the feature's choice (ADR 0094) - this shell has no opinion on that, and no Escape handling of its own.
export function FocusShell({
  status,
  statusLabel = 'Status',
  rail,
  railLabel = 'Rail',
  railCollapsed = false,
  commands,
  commandsLabel = 'Commands',
  children,
  className = '',
}: FocusShellProps) {
  const showRail = rail !== undefined && !railCollapsed;
  return (
    <div data-surface="booth" className={`flex size-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)] ${className}`}>
      <div role="region" aria-label={statusLabel} className="flex flex-none items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
        {status}
      </div>
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto p-4">{children}</main>
        {showRail && (
          <aside role="complementary" aria-label={railLabel} className="w-72 flex-none overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-4">
            {rail}
          </aside>
        )}
      </div>
      <div role="region" aria-label={commandsLabel} className="flex flex-none items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2">
        {commands}
      </div>
    </div>
  );
}
