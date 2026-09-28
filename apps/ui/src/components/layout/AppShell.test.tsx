// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { TooltipProvider } from '../primitives/Tooltip';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { DawMockSeed } from '../../api/dawMock';

afterEach(cleanup);

const noHistory = { canGoBack: false, canGoForward: false, back: () => {}, forward: () => {} };

function renderShell(props: Partial<Parameters<typeof AppShell>[0]> = {}, daw: DawMockSeed = {}) {
  const api = createMockApi({}, { daw });
  return render(
    <ApiProvider api={api}>
      <TooltipProvider>
        <AppShell pathname="/" navigate={() => {}} projectName="Alice" hasManuscript dawFileLinked onOpenEnginePanel={() => {}} history={noHistory} {...props}>
          <div>page content</div>
        </AppShell>
      </TooltipProvider>
    </ApiProvider>,
  );
}

describe('AppShell nav gating (PRD project-workspace-and-daw-link.prd.md, W16/W17)', () => {
  it('disables the manuscript pages, and only those, when there is no manuscript', () => {
    renderShell({ hasManuscript: false, dawFileLinked: false });
    for (const name of ['Script', 'Story Bible', 'Booth']) {
      expect(screen.getAllByRole('button', { name }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    }
    for (const name of ['Home', 'Proof', 'Pickups', 'Delivery']) {
      expect(screen.getAllByRole('button', { name }).every((button) => (button as HTMLButtonElement).disabled)).toBe(false);
    }
    expect(screen.getAllByRole('group', { name: /Import a manuscript to unlock this page/ }).length).toBeGreaterThan(0);
  });

  // stage-navigation-and-page-replacement.prd.md Phase 5: Proof replaces Proofing and Review, and its compare run gates itself on
  // the DAW inside the chapter view (CompareRun.test.tsx), so the nav item is never off - not for a missing file, nor for REAPER.
  it('never gates Proof, with no linked file and with REAPER not connected', () => {
    renderShell({ hasManuscript: true, dawFileLinked: false }, { connected: false });
    expect(screen.getAllByRole('button', { name: 'Proof' }).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryAllByRole('button', { name: 'Proofing' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'Review' })).toHaveLength(0);
  });

  it('marks Proof active on the book level and on a chapter view', () => {
    renderShell({ pathname: '/proof/chapter-1' });
    expect(screen.getAllByRole('button', { name: 'Proof' }).some((button) => button.getAttribute('aria-current') === 'page')).toBe(true);
  });
});

describe('AppShell header pill (PRD project-workspace-and-daw-link.prd.md, W15)', () => {
  it('shows "No REAPER project linked" and opens the engine panel on click when nothing is linked (Phase 6)', () => {
    const onOpenEnginePanel = vi.fn();
    renderShell({ dawFileLinked: false, onOpenEnginePanel });
    const pill = screen.getByRole('button', { name: /No REAPER project linked/ });
    expect(pill.textContent).toContain('No REAPER project linked');
    fireEvent.click(pill);
    expect(onOpenEnginePanel).toHaveBeenCalledTimes(1);
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

// stage-navigation-and-page-replacement.prd.md Phase 1 (ADR 0407 item 3, Q5, Q6): the nav is grouped by production
// stage, each existing page held under its current name; `/production` (PR #760) has no nav entry until Phase 2.
describe('AppShell grouped navigation (Phase 1)', () => {
  it('names every group (sidebar, rail and drawer all expose the same accessible name)', () => {
    renderShell();
    for (const label of ['Production', 'Prep', 'Record', 'Review', 'Finish']) {
      expect(screen.getAllByRole('group', { name: label }).length).toBeGreaterThan(0);
    }
  });

  it('has no "Production" nav item (dropped from PR #760, D79): the page stays reachable, unlisted', () => {
    renderShell();
    expect(screen.queryAllByRole('button', { name: 'Production' })).toHaveLength(0);
  });

  it('lists every other page, with Proof in place of Proofing and Review (Phase 5) and Booth in place of the Teleprompter (Phase 4)', () => {
    renderShell();
    for (const name of ['Home', 'Script', 'Story Bible', 'Booth', 'Proof', 'Pickups', 'Delivery', 'Settings']) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
  });

  // Phase 6: the engine panel replaces the Tracks page, so the Review group is Proof and Pickups only.
  it('has no Tracks item: the engine chip opens what it held', () => {
    renderShell();
    expect(screen.queryAllByRole('button', { name: 'Tracks' })).toHaveLength(0);
    const review = screen.getAllByRole('group', { name: 'Review' })[0];
    expect(
      within(review)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Proof', 'Pickups']);
  });

  // Phase 7: Pickups replaces the Tracks page's Pickups dialog, as its own item right after Proof in the Review group.
  it('lists Pickups in the Review group, after Proof', () => {
    renderShell();
    const review = screen.getAllByRole('group', { name: 'Review' })[0];
    const names = within(review)
      .getAllByRole('button')
      .map((button) => button.textContent?.trim());
    expect(names.slice(0, 2)).toEqual(['Proof', 'Pickups']);
  });

  it('opens /pickups from the Pickups item', () => {
    const navigate = vi.fn();
    renderShell({ navigate });
    fireEvent.click(screen.getAllByRole('button', { name: 'Pickups' })[0]);
    expect(navigate).toHaveBeenCalledWith('/pickups');
  });
});

// Phase 1 (Q7): the engine chip replaces the REAPER pill, in place.
describe('AppShell engine chip (Phase 1)', () => {
  it('defaults to the REAPER pill states when no engine prop is given', () => {
    renderShell({ dawFileLinked: false });
    expect(screen.getByRole('button', { name: /No REAPER project linked/ })).toBeTruthy();
  });

  it('shows "Built-in recorder" and drops the REAPER link action when engine is builtin', () => {
    renderShell({ engine: 'builtin' });
    expect(screen.getByLabelText('Built-in recorder')).toBeTruthy();
    expect(screen.queryByText(/REAPER/)).toBeNull();
  });
});

// Phase 1 (app-navigation-and-zoom-controls.prd.md, Q1 A, Q8): Back and Forward at the left of the header.
describe('AppShell header history controls (Phase 1)', () => {
  it('are disabled with a reason when there is nowhere to go', () => {
    renderShell({ history: noHistory });
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
  });

  it('calls back()/forward() only when enabled', () => {
    const back = vi.fn();
    const forward = vi.fn();
    renderShell({ history: { canGoBack: true, canGoForward: true, back, forward } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it('does not call back() when disabled', () => {
    const back = vi.fn();
    renderShell({ history: { ...noHistory, back } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).not.toHaveBeenCalled();
  });
});
