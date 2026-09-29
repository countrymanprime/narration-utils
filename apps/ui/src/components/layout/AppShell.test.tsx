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
const defaultZoom = { percent: 100, canZoomOut: false, canZoomIn: true, zoomIn: () => {}, zoomOut: () => {}, reset: () => {}, announcement: '' };

function renderShell(props: Partial<Parameters<typeof AppShell>[0]> = {}, daw: DawMockSeed = {}) {
  const api = createMockApi({}, { daw });
  return render(
    <ApiProvider api={api}>
      <TooltipProvider>
        <AppShell
          pathname="/"
          navigate={() => {}}
          projectName="Alice"
          hasManuscript
          dawFileLinked
          onOpenEnginePanel={() => {}}
          history={noHistory}
          zoom={defaultZoom}
          {...props}
        >
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
    for (const name of ['Production', 'Proof', 'Pickups', 'Master & QC']) {
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

  it('shows "REAPER linked" once one is, and never claims to know whether REAPER is running', () => {
    renderShell({ dawFileLinked: true });
    const pill = screen.getByRole('button', { name: /REAPER linked/ });
    expect(pill.textContent).toBe('REAPER linked');
    expect(screen.queryByText(/detected/i)).toBeNull();
    expect(screen.queryByText(/No DAW detected/i)).toBeNull();
  });
});

// Phase 7 (PRD project-workspace-and-daw-link.prd.md, ADR 0092): the mismatch state only appears once a live
// heartbeat disagrees with the linked file, never from a linked-but-unconfirmed state.
describe('AppShell header pill mismatch state (Phase 7)', () => {
  it('still reads "REAPER linked" when linked but not yet confirmed reachable', () => {
    renderShell({ dawFileLinked: true, dawReachable: false, dawProjectMatches: false });
    expect(screen.getByRole('button', { name: /REAPER linked/ })).toBeTruthy();
    expect(screen.queryByText(/Wrong REAPER project open/)).toBeNull();
  });

  it('shows "Wrong REAPER project open" only when REAPER is reachable and its open project does not match', () => {
    renderShell({ dawFileLinked: true, dawReachable: true, dawProjectMatches: false });
    const pill = screen.getByRole('button', { name: /Wrong REAPER project open/ });
    expect(pill.textContent).toBe('Wrong REAPER project open');
  });

  it('reads "REAPER linked" when reachable and the open project matches', () => {
    renderShell({ dawFileLinked: true, dawReachable: true, dawProjectMatches: true });
    expect(screen.getByRole('button', { name: /REAPER linked/ })).toBeTruthy();
    expect(screen.queryByText(/Wrong REAPER project open/)).toBeNull();
  });
});

// stage-navigation-and-page-replacement.prd.md Phase 1 (ADR 0407 item 3, Q5, Q6): the nav is grouped by production
// stage, each existing page held under its current name until the phase that replaces it; Phase 2 made Production the item at `/`.
describe('AppShell grouped navigation (Phase 1)', () => {
  it('names every group (sidebar, rail and drawer all expose the same accessible name)', () => {
    renderShell();
    for (const label of ['Production', 'Prep', 'Record', 'Review', 'Finish']) {
      expect(screen.getAllByRole('group', { name: label }).length).toBeGreaterThan(0);
    }
  });

  // ADR 0407 item 3 and ADR 0635 item 3: on the wide rail every group's heading is drawn, the first one too (its space stands in
  // for the benchmark mocks' Schedule item, which has no page), never only named for a screen reader.
  it('draws every group heading on the wide rail, the first one too', () => {
    const { container } = renderShell();
    for (const label of ['Production', 'Prep', 'Record', 'Review', 'Finish']) {
      const heading = container.querySelector(`#nav-group-${label.toLowerCase()}`);
      expect(heading?.textContent).toBe(label);
      expect(heading?.className).not.toMatch(/\bsr-only\b/);
      expect(heading?.className).toMatch(/\bsection-label\b/);
    }
  });

  // Phase 2: the Production home replaced Home at `/`, as the Production group's one item, active on `/` and nowhere else.
  it("has Production, not Home, as the Production group's item, active at /", () => {
    renderShell({ pathname: '/' });
    expect(screen.queryAllByRole('button', { name: 'Home' })).toHaveLength(0);
    const [item] = screen.getAllByRole('group', { name: 'Production' });
    const button = within(item).getByRole('button', { name: 'Production' });
    expect(button.getAttribute('aria-current')).toBe('page');
  });

  it('lists every other page, with Production in place of Home (Phase 2), Proof in place of Proofing and Review (Phase 5) and Booth in place of the Teleprompter (Phase 4)', () => {
    renderShell();
    for (const name of ['Production', 'Script', 'Story Bible', 'Booth', 'Proof', 'Pickups', 'Master & QC', 'Settings']) {
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

// Phase 2 (app-navigation-and-zoom-controls.prd.md, Q1/Q9, ADR 0201): the zoom group, after a running timer chip and
// before the engine chip.
describe('AppShell header zoom group (Phase 2)', () => {
  it('is a "Zoom" group with the level readout between zoom out and zoom in', () => {
    renderShell({ zoom: { ...defaultZoom, percent: 125, canZoomOut: true } });
    const group = screen.getByRole('group', { name: 'Zoom' });
    expect(within(group).getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(within(group).getByText('125%')).toBeTruthy();
  });

  it('zoom out is disabled at 100%, matching canZoomOut', () => {
    renderShell({ zoom: defaultZoom });
    expect(screen.getByRole('button', { name: 'Zoom out' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('zoom in is disabled at the 200% ceiling, matching canZoomIn', () => {
    renderShell({ zoom: { ...defaultZoom, percent: 200, canZoomOut: true, canZoomIn: false } });
    expect(screen.getByRole('button', { name: 'Zoom in' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('calls zoomIn/zoomOut only when enabled', () => {
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    renderShell({ zoom: { ...defaultZoom, percent: 125, canZoomOut: true, zoomIn, zoomOut } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(zoomOut).toHaveBeenCalledTimes(1);
  });

  it('the readout is disabled at exactly 100% (Q9 A) and calls reset() when not', () => {
    renderShell({ zoom: defaultZoom });
    const atDefault = screen.getByRole('button', { name: /Reset zoom to 100%/ });
    expect(atDefault.getAttribute('aria-disabled')).toBe('true');
    cleanup();

    const reset = vi.fn();
    renderShell({ zoom: { ...defaultZoom, percent: 125, canZoomOut: true, reset } });
    const enabled = screen.getByRole('button', { name: /Reset zoom to 100% \(now 125%\)/ });
    expect(enabled.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(enabled);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('announces a debounced level change politely', () => {
    renderShell({ zoom: { ...defaultZoom, percent: 125, canZoomOut: true, announcement: 'Zoom 125%' } });
    expect(screen.getByText('Zoom 125%')).toBeTruthy();
  });
});

// Phase 2 (the header, item 4): the running-timer chip sits right-aligned before the engine chip, and only while a timer runs.
describe('AppShell running-timer chip (Phase 2)', () => {
  it('shows no timer chip when no timer runs', () => {
    renderShell();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('shows the running timer between the project name and the engine chip', () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    renderShell({ timer: { startedAt, chapterTitle: 'Chapter 7', stage: 'recording' } });
    const chip = screen.getByRole('timer', { name: /^Timer running on Chapter 7, Recording: 0:01:0\d$/ });
    expect(chip.textContent).toMatch(/^0:01:0\d· timer on Chapter 7$/);
    const header = chip.closest('header')!;
    const order = [within(header).getByText('Project'), chip, within(header).getByRole('button', { name: /REAPER linked/ })];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe('AppShell rail (mock fidelity, N-B61)', () => {
  // Mock 01-05 draw the product's name as "NARRATION / STUDIO" (owner ruling 2026-09-29); the app said "Console".
  it('names the product Studio, not Console', () => {
    const { container } = renderShell();
    expect(container.textContent).toContain('Studio');
    expect(container.textContent).not.toContain('Console');
  });

  it('draws a count badge on Story Bible, Proof and Pickups only when it is given one', () => {
    renderShell({ navCounts: { storyBible: 3, proof: 14, pickups: 9 } });
    expect(screen.getByRole('button', { name: 'Story Bible, 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Proof, 14' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pickups, 9' })).toBeTruthy();
    // The icon rail has no room for a badge and keeps the plain name.
    expect(screen.getByRole('button', { name: 'Proof' })).toBeTruthy();
  });

  it('draws no badge for a count that is missing or zero, and never on the other items', () => {
    renderShell({ navCounts: { storyBible: 0, proof: undefined } });
    expect(screen.queryByRole('button', { name: /Story Bible, / })).toBeNull();
    expect(screen.queryByRole('button', { name: /Proof, / })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pickups, / })).toBeNull();
    expect(screen.queryByRole('button', { name: /(Script|Booth|Production|Master & QC), \d/ })).toBeNull();
  });
});
