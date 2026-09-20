// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu';

afterEach(cleanup);

const items = ['Character', 'Location', 'Organization'].map((label) => ({ key: label, label, onSelect: vi.fn() }));

function renderMenu(disabled = false) {
  items.forEach((item) => item.onSelect.mockClear());
  return render(
    <div>
      <Menu items={items} disabled={disabled}>
        Character
      </Menu>
      <button>After</button>
    </div>,
  );
}

describe('Menu', () => {
  it('is a menu button that opens a menu of items with a click', async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Character' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    await user.click(trigger);
    expect(await screen.findAllByRole('menuitem')).toHaveLength(3);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('moves with the arrow keys, selects with Enter, closes and returns focus to the button', async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Character' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await screen.findAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Character'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Location');
    await user.keyboard('{Enter}');
    expect(items[1].onSelect).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes on Escape and selects on a click', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Character' }));
    await screen.findAllByRole('menuitem');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Character' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Organization' }));
    expect(items[2].onSelect).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    renderMenu(true);
    await user.click(screen.getByRole('button', { name: 'Character' }));
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
