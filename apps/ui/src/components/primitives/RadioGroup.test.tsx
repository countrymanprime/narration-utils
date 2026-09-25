// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RadioGroup } from './RadioGroup';

afterEach(cleanup);

const OPTIONS = [
  { value: 'reference', label: 'Not a chapter', description: 'A part title, an epigraph or a false split. Hidden from navigation too.' },
  { value: 'opening', label: 'Front matter', description: "Stays in the manuscript's navigation, not recorded as a chapter." },
] as const;

function Controlled({ onChange = () => undefined }: { onChange?: (next: 'reference' | 'opening') => void }) {
  const [value, setValue] = useState<'reference' | 'opening'>('reference');
  return (
    <RadioGroup
      label="What is it?"
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      options={OPTIONS}
    />
  );
}

describe('RadioGroup', () => {
  it('names the group and each option, with the description visible for both at once', () => {
    render(<Controlled />);
    expect(screen.getByRole('radiogroup', { name: 'What is it?' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Not a chapter' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Front matter' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/A part title, an epigraph/)).toBeTruthy();
    expect(screen.getByText(/Stays in the manuscript/)).toBeTruthy();
  });

  it('switches on a click and reports the new value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Front matter' }));
    expect(onChange).toHaveBeenCalledWith('opening');
    expect(screen.getByRole('radio', { name: 'Front matter' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Not a chapter' }).getAttribute('aria-checked')).toBe('false');
  });

  it('switches on the label text being pressed', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByText('Front matter'));
    expect(screen.getByRole('radio', { name: 'Front matter' }).getAttribute('aria-checked')).toBe('true');
  });

  it('moves with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Front matter' }).getAttribute('aria-checked')).toBe('true');
  });
});
