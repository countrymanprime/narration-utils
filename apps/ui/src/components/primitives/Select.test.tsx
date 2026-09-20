// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

function Controlled({ onChange = () => undefined }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('a');
  return (
    <Select
      label="Chapter status"
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe('Select', () => {
  it('is the native select, named by its label, showing each option', () => {
    render(<Controlled />);
    const select = screen.getByRole('combobox', { name: 'Chapter status' }) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['Alpha', 'Beta']);
    expect(select.value).toBe('a');
  });

  it('reports the chosen value when the change is fired the way the existing tests fire it', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Chapter status'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
    expect((screen.getByLabelText('Chapter status') as HTMLSelectElement).value).toBe('b');
  });

  it('reports the chosen value when the user picks an option', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Chapter status' }), 'Beta');
    expect(onChange).toHaveBeenLastCalledWith('b');
  });

  it('is named by a visible label through its id instead', () => {
    render(
      <>
        <label htmlFor="chapter">Chapter</label>
        <Select id="chapter" value="a" options={OPTIONS} onChange={() => undefined} />
      </>,
    );
    expect(screen.getByRole('combobox', { name: 'Chapter' })).toBeTruthy();
  });

  it('fills its container only when asked', () => {
    const { rerender } = render(<Select label="x" value="a" options={OPTIONS} onChange={() => undefined} />);
    expect(screen.getByLabelText('x').className).not.toContain('w-full');
    rerender(<Select label="x" fullWidth value="a" options={OPTIONS} onChange={() => undefined} />);
    expect(screen.getByLabelText('x').className).toContain('w-full');
  });

  it('cannot be changed when disabled', async () => {
    const onChange = vi.fn();
    render(<Select label="Status" disabled value="a" options={OPTIONS} onChange={onChange} />);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'b');
    expect(onChange).not.toHaveBeenCalled();
  });
});
