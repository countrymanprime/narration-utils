// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { danglingAriaReferences } from './ariaReferences';
import { Tooltip, TooltipProvider, TooltipTarget } from './Tooltip';

afterEach(() => {
  // jsdom keeps :focus-visible state on the element that was focused last; drop it so the next test starts clean.
  (document.activeElement as HTMLElement | null)?.blur();
  cleanup();
  vi.useRealTimers();
});

const TEXT = 'Helpful tooltip guidance';

describe('the info icon (Tooltip)', () => {
  it('is a real button whose text is its accessible description', () => {
    render(<Tooltip text={TEXT} />);
    const icon = screen.getByRole('button', { name: 'More information' });
    expect(icon.tagName).toBe('BUTTON');
    // Its text is its description, so a screen reader hears it without the popup being open.
    expect(icon.getAttribute('aria-description')).toBe(TEXT);
  });

  it('takes the name a page gives it, so two icons can be told apart', () => {
    render(
      <>
        <Tooltip text={TEXT} label="About front matter" />
        <Tooltip text={TEXT} label="About reference material" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'About front matter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'About reference material' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More information' })).toBeNull();
  });

  it('shows its text as a tooltip when the keyboard reaches it, and Escape hides it', async () => {
    const user = userEvent.setup();
    render(<Tooltip text={TEXT} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More information' }));
    expect((await screen.findByRole('tooltip')).textContent).toBe(TEXT);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More information' }));
  });

  it('after Escape a press opens the note again and the next press closes it (Escape forgets that focus opened it)', async () => {
    const user = userEvent.setup();
    render(<Tooltip text={TEXT} />);
    await user.tab();
    await screen.findByRole('tooltip');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.keyboard('{Enter}');
    await screen.findByRole('tooltip');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('hides the tooltip again when focus leaves, and focus lands on the next control', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip text={TEXT} />
        <button>Next</button>
      </>,
    );
    await user.tab();
    await screen.findByRole('tooltip');
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }));
  });

  it('keeps the tooltip open when Enter is pressed on an icon the keyboard just opened, and a second Enter closes it', async () => {
    const user = userEvent.setup();
    render(<Tooltip text={TEXT} />);
    await user.tab();
    await screen.findByRole('tooltip');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('stays open when focus moves onto its own popup', async () => {
    const user = userEvent.setup();
    render(<Tooltip text={TEXT} />);
    await user.tab();
    const popup = await screen.findByRole('tooltip');
    popup.focus();
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('opens on a press and closes on a second press', async () => {
    const user = userEvent.setup();
    render(<Tooltip text={TEXT} />);
    const icon = screen.getByRole('button', { name: 'More information' });
    await user.click(icon);
    expect((await screen.findByRole('tooltip')).textContent).toBe(TEXT);
    expect(icon.getAttribute('aria-expanded')).toBe('true');
    await user.click(icon);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('waits a second for a resting pointer', async () => {
    vi.useFakeTimers();
    render(<Tooltip text={TEXT} />);
    const icon = screen.getByRole('button', { name: 'More information' });
    fireEvent.mouseEnter(icon);
    fireEvent.mouseMove(icon);
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(screen.queryByRole('tooltip')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(screen.getByRole('tooltip').textContent).toBe(TEXT);
  });

  it('clears its popup on unmount instead of leaving it stuck (e.g. a click that navigates away)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Tooltip text="Jump to script in Manuscript" />);
    await user.tab();
    await screen.findByRole('tooltip');
    unmount();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('leaves no dangling aria reference', async () => {
    const user = userEvent.setup();
    render(<Tooltip text={TEXT} />);
    expect(danglingAriaReferences()).toEqual([]);
    await user.tab();
    await screen.findByRole('tooltip');
    expect(danglingAriaReferences()).toEqual([]);
  });
});

describe('TooltipTarget', () => {
  const target = (
    <TooltipProvider>
      <TooltipTarget text="View manuscript">
        <button aria-label="View manuscript">V</button>
      </TooltipTarget>
    </TooltipProvider>
  );

  it('shows the hint at once on keyboard focus and hides it on blur', async () => {
    const user = userEvent.setup();
    render(target);
    await user.tab();
    expect((await screen.findByRole('tooltip')).textContent).toBe('View manuscript');
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('waits a full second of hover, and a pointer that leaves early shows nothing', async () => {
    vi.useFakeTimers();
    render(target);
    // The pointer enters the hint's own element (the wrapper around the button); a real pointer crossing the button does too.
    const trigger = screen.getByRole('button', { name: 'View manuscript' }).parentElement as HTMLElement;
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    await act(() => vi.advanceTimersByTimeAsync(990));
    expect(screen.queryByRole('tooltip')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(trigger);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    await act(() => vi.advanceTimersByTimeAsync(500));
    fireEvent.mouseLeave(trigger);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('leaves the child alone: its own accessible name is untouched and no aria reference dangles', async () => {
    const user = userEvent.setup();
    render(target);
    expect(screen.getByRole('button', { name: 'View manuscript' }).getAttribute('aria-describedby')).toBeNull();
    await user.tab();
    await screen.findByRole('tooltip');
    expect(danglingAriaReferences()).toEqual([]);
  });

  it('makes the wrapper of a disabled child the tab stop and names it with the reason', async () => {
    const user = userEvent.setup();
    render(
      <TooltipTarget text="Import a manuscript to unlock Proofing.">
        <button aria-label="Open Proofing" disabled>
          Proofing
        </button>
      </TooltipTarget>,
    );
    const wrapper = screen.getByRole('group', { name: 'Import a manuscript to unlock Proofing.' });
    expect(wrapper.getAttribute('tabindex')).toBe('0');
    await user.tab();
    expect(document.activeElement).toBe(wrapper);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Import a manuscript to unlock Proofing.');
  });

  it('Escape dismisses a hint without moving focus, and a click closes it', async () => {
    const user = userEvent.setup();
    render(target);
    const button = screen.getByRole('button', { name: 'View manuscript' });
    await user.tab();
    await screen.findByRole('tooltip');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(button);
    await user.tab({ shift: true });
    await user.tab();
    await screen.findByRole('tooltip');
    await user.click(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('clears the hint on unmount instead of leaving it stuck', async () => {
    const user = userEvent.setup();
    const { unmount } = render(target);
    await user.tab();
    await screen.findByRole('tooltip');
    unmount();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('gives an enabled child no wrapper role or tab stop', () => {
    render(target);
    const wrapper = screen.getByRole('button', { name: 'View manuscript' }).parentElement;
    expect(wrapper?.getAttribute('tabindex')).toBeNull();
    expect(wrapper?.getAttribute('role')).toBeNull();
  });
});

describe('a hint inside a dialog', () => {
  it('takes Escape first: the hint closes and the dialog stays until the next Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog title="Add note" onClose={onClose} actions={<Button variant="primary">Save</Button>}>
        <Tooltip text={TEXT} />
      </Dialog>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add note' });
    // Focus starts on the dialog body; one Tab reaches the info icon inside it.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More information' }));
    await screen.findByRole('tooltip');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
