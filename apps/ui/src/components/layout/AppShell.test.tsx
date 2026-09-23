// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { TooltipProvider } from '../primitives/Tooltip';

afterEach(cleanup);

function renderShell(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return render(
    <TooltipProvider>
      <AppShell pathname="/" navigate={() => {}} projectName="Alice" hasManuscript dawFileLinked onLinkDawFile={() => {}} {...props}>
        <div>page content</div>
      </AppShell>
    </TooltipProvider>,
  );
}

describe('AppShell nav gating (PRD project-workspace-and-daw-link.prd.md, W16/W17)', () => {
  it('disables only Proofing among the DAW-independent pages when there is a manuscript but no linked DAW file', () => {
    renderShell({ hasManuscript: true, dawFileLinked: false });
    expect(screen.getAllByRole('button', { name: 'Proofing' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    for (const name of ['Manuscript', 'Story Bible', 'Teleprompter', 'Tracks', 'Home']) {
      expect(screen.getAllByRole('button', { name }).every((button) => (button as HTMLButtonElement).disabled)).toBe(false);
    }
  });

  it('names both missing requirements in the combined reason (W17) when neither is met', () => {
    renderShell({ hasManuscript: false, dawFileLinked: false });
    const proofing = screen.getAllByRole('button', { name: 'Proofing' })[0] as HTMLButtonElement;
    expect(proofing.disabled).toBe(true);
    // The disabled NavButton wraps itself in a labelled group carrying the combined reason as its accessible name.
    expect(screen.getAllByRole('group', { name: /Import a manuscript and link a REAPER project/ }).length).toBeGreaterThan(0);
  });

  it('enables Proofing once both a manuscript and a DAW file are present', () => {
    renderShell({ hasManuscript: true, dawFileLinked: true });
    expect(screen.getAllByRole('button', { name: 'Proofing' }).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe('AppShell header pill (PRD project-workspace-and-daw-link.prd.md, W15)', () => {
  it('shows "No REAPER project linked" and opens the picker on click when nothing is linked', () => {
    const onLinkDawFile = vi.fn();
    renderShell({ dawFileLinked: false, onLinkDawFile });
    const pill = screen.getByRole('button', { name: /No REAPER project linked/ });
    expect(pill.textContent).toContain('No REAPER project linked');
    fireEvent.click(pill);
    expect(onLinkDawFile).toHaveBeenCalledTimes(1);
  });

  it('shows "REAPER project linked" once one is, and never claims to know whether REAPER is running', () => {
    renderShell({ dawFileLinked: true });
    const pill = screen.getByRole('button', { name: /REAPER project linked/ });
    expect(pill.textContent).toBe('REAPER project linked');
    expect(screen.queryByText(/detected/i)).toBeNull();
    expect(screen.queryByText(/No DAW detected/i)).toBeNull();
  });
});

// Phase 7 (PRD project-workspace-and-daw-link.prd.md, ADR 0092): the mismatch state only appears once a live
// heartbeat disagrees with the linked file, never from a linked-but-unconfirmed state.
describe('AppShell header pill mismatch state (Phase 7)', () => {
  it('still reads "REAPER project linked" when linked but not yet confirmed reachable', () => {
    renderShell({ dawFileLinked: true, dawReachable: false, dawProjectMatches: false });
    expect(screen.getByRole('button', { name: /REAPER project linked/ })).toBeTruthy();
    expect(screen.queryByText(/Wrong REAPER project open/)).toBeNull();
  });

  it('shows "Wrong REAPER project open" only when REAPER is reachable and its open project does not match', () => {
    renderShell({ dawFileLinked: true, dawReachable: true, dawProjectMatches: false });
    const pill = screen.getByRole('button', { name: /Wrong REAPER project open/ });
    expect(pill.textContent).toBe('Wrong REAPER project open');
  });

  it('reads "REAPER project linked" when reachable and the open project matches', () => {
    renderShell({ dawFileLinked: true, dawReachable: true, dawProjectMatches: true });
    expect(screen.getByRole('button', { name: /REAPER project linked/ })).toBeTruthy();
    expect(screen.queryByText(/Wrong REAPER project open/)).toBeNull();
  });
});
