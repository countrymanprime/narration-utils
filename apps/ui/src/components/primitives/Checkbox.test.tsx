// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

afterEach(cleanup);

function Controlled({ onChange = () => undefined, disabled = false }: { onChange?: (next: boolean) => void; disabled?: boolean }) {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      checked={checked}
      disabled={disabled}
      onChange={(next) => {
        onChange(next);
        setChecked(next);
      }}
    >
      Alice
    </Checkbox>
  );
}

describe('Checkbox', () => {
  it('is a checkbox named by its label text and reports the new state', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Alice' });
    expect(box.getAttribute('aria-checked')).toBe('false');
    await user.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(box.getAttribute('aria-checked')).toBe('true');
  });

  it('toggles when the label text is pressed', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByText('Alice'));
    expect(screen.getByRole('checkbox', { name: 'Alice' }).getAttribute('aria-checked')).toBe('true');
  });

  it('toggles from the keyboard with Space', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'Alice' }).getAttribute('aria-checked')).toBe('true');
  });

  it('does nothing when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} disabled />);
    await user.click(screen.getByText('Alice'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
