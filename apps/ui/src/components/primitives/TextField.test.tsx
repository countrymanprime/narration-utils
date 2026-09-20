// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextField } from './TextField';

afterEach(cleanup);

function Controlled({ onChange = () => undefined }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <TextField
      label="Add a vocabulary term"
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe('TextField', () => {
  it('is a text box named by its label, and reports the text typed', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Add a vocabulary term' }), 'Wonderland');
    expect(onChange).toHaveBeenLastCalledWith('Wonderland');
  });

  it('reports a change fired the way the existing tests fire it', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Add a vocabulary term'), { target: { value: 'Rabbit' } });
    expect(onChange).toHaveBeenCalledWith('Rabbit');
  });

  it('is named by a visible label through its id instead', () => {
    render(
      <>
        <label htmlFor="microphone">Microphone</label>
        <TextField id="microphone" value="" onChange={() => undefined} />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Microphone' })).toBeTruthy();
  });

  it('passes the role, aria attributes, key handler, placeholder, ref and disabled state through', async () => {
    const onKeyDown = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(
      <TextField
        ref={ref}
        label="Add an alias"
        role="combobox"
        aria-expanded={true}
        aria-describedby="hint"
        placeholder="Add an alias…"
        onKeyDown={onKeyDown}
        value=""
        onChange={() => undefined}
      />,
    );
    const box = screen.getByRole('combobox', { name: 'Add an alias' });
    expect(ref.current).toBe(box);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toBe('hint');
    expect(box.getAttribute('placeholder')).toBe('Add an alias…');
    await userEvent.setup().type(box, '{ArrowDown}');
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('is a colour picker only when asked, and never any other input type', () => {
    render(<TextField label="Note colour hex" type="color" value="#ffd54f" onChange={() => undefined} />);
    const swatch = screen.getByLabelText('Note colour hex') as HTMLInputElement;
    expect(swatch.getAttribute('type')).toBe('color');
    expect(swatch.value).toBe('#ffd54f');
  });

  it('is disabled when asked, and shows the value it was given', () => {
    render(<TextField label="Name" disabled value="Alice" onChange={() => undefined} />);
    const box = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.value).toBe('Alice');
  });
});
