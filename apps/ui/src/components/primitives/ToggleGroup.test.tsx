// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToggleGroup } from './ToggleGroup';

afterEach(cleanup);

const OPTIONS = [
  { value: 'Quiet', label: 'Quiet' },
  { value: 'Normal', label: 'Normal' },
  { value: 'Verbose', label: 'Verbose', disabled: true },
];

function Controlled({ onChange = () => undefined }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('Normal');
  return (
    <ToggleGroup
      label="Log detail"
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe('ToggleGroup', () => {
  it('is a named group with the chosen chip pressed and the others not', () => {
    render(<Controlled />);
    const group = screen.getByRole('group', { name: 'Log detail' });
    const pressed = within(group)
      .getAllByRole('button')
      .map((chip) => [chip.textContent, chip.getAttribute('aria-pressed')]);
    expect(pressed).toEqual([
      ['Quiet', 'false'],
      ['Normal', 'true'],
      ['Verbose', 'false'],
    ]);
  });

  it('reports the value of the chip pressed and moves the press to it', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Quiet' }));
    expect(onChange).toHaveBeenCalledWith('Quiet');
    expect(screen.getByRole('button', { name: 'Quiet' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Normal' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reports the chosen chip when it is pressed again, and the caller decides', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Normal' }));
    expect(onChange).toHaveBeenCalledWith('Normal');
  });

  it('does not report a disabled chip', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Verbose' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps every enabled chip a tab stop', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Quiet' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Normal' }));
  });
});
