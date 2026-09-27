// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineChip } from './EngineChip';
import { TooltipProvider } from '../primitives/Tooltip';

afterEach(cleanup);

function renderChip(props: Partial<Parameters<typeof EngineChip>[0]> = {}) {
  return render(
    <TooltipProvider>
      <EngineChip dawFileLinked={false} onLinkDawFile={() => {}} {...props} />
    </TooltipProvider>,
  );
}

// The chip replaces the REAPER pill in place (stage-navigation-and-page-replacement.prd.md Phase 1, ADR 0407 item
// 4): its three REAPER states and click action are unchanged from the pill it replaces.
describe('EngineChip REAPER states (unchanged from the pill)', () => {
  it('shows "No REAPER project linked" and opens the picker on click when nothing is linked', () => {
    const onLinkDawFile = vi.fn();
    renderChip({ dawFileLinked: false, onLinkDawFile });
    const chip = screen.getByRole('button', { name: /No REAPER project linked/ });
    expect(chip.textContent).toContain('No REAPER project linked');
    fireEvent.click(chip);
    expect(onLinkDawFile).toHaveBeenCalledTimes(1);
  });

  it('shows "REAPER project linked" once one is', () => {
    renderChip({ dawFileLinked: true });
    const chip = screen.getByRole('button', { name: /REAPER project linked/ });
    expect(chip.textContent).toBe('REAPER project linked');
  });

  it('shows "Wrong REAPER project open" only when REAPER is reachable and its open project does not match', () => {
    renderChip({ dawFileLinked: true, dawReachable: true, dawProjectMatches: false });
    const chip = screen.getByRole('button', { name: /Wrong REAPER project open/ });
    expect(chip.textContent).toBe('Wrong REAPER project open');
  });

  it('still reads "REAPER project linked" when linked but not yet confirmed reachable', () => {
    renderChip({ dawFileLinked: true, dawReachable: false, dawProjectMatches: false });
    expect(screen.getByRole('button', { name: /REAPER project linked/ })).toBeTruthy();
    expect(screen.queryByText(/Wrong REAPER project open/)).toBeNull();
  });
});

// The fourth state (Q7): UI-only until native recording chooses it, so it carries no link action.
describe('EngineChip built-in recorder state (Q7)', () => {
  it('reads "Built-in recorder" and is not a button (there is nothing to link)', () => {
    renderChip({ engine: 'builtin' });
    expect(screen.getByLabelText('Built-in recorder')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ignores the REAPER link state entirely while built-in', () => {
    renderChip({ engine: 'builtin', dawFileLinked: true, dawReachable: true, dawProjectMatches: false });
    expect(screen.queryByText(/REAPER/)).toBeNull();
  });
});
