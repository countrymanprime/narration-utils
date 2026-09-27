import type { ReactNode } from 'react';

// The narrow companion-panel layout (the DAW companion mock, studio-ui-primitives.prd.md phase 10): a header naming
// the panel, its live status and the one action back to the full app, above a stack of sections. Narrow (320-480 px),
// always-on-top and the window itself are the host's (ADR 0360); this primitive only lays out what goes inside it, and
// is judged at the atlas's narrow (390 px) viewport. Unlike `FocusShell`'s four regions, the companion mock keeps only
// a header and a body: there is no rail or command bar to drop separately, since the toolbar and hotkeys the mock shows
// are sections the caller stacks like any other.
export function CompactShell({ title, status, action, children }: { title: string; status?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex size-full max-w-[30rem] min-w-[20rem] flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-[0.85rem] py-[0.65rem]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-sm font-semibold [overflow-wrap:anywhere]">{title}</h1>
          {status}
        </div>
        {action}
      </header>
      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto p-[0.85rem]">{children}</main>
    </div>
  );
}
