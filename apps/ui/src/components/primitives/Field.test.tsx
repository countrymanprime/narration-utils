// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { danglingAriaReferences } from './ariaReferences';
import { Field } from './Field';

afterEach(cleanup);

const noop = () => undefined;

describe('Field', () => {
  it('names its control by its label, for an input and for a textarea', () => {
    render(
      <>
        <Field label="Name" value="Alice" onChange={noop} />
        <Field label="Description" textarea value="A curious child" onChange={noop} />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Name' }).tagName).toBe('INPUT');
    expect(screen.getByRole('textbox', { name: 'Description' }).tagName).toBe('TEXTAREA');
  });

  it('reports typing and blur, and stays controlled', async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const user = userEvent.setup();
    render(<Field label="Name" value="Al" onChange={onChange} onBlur={onBlur} />);
    const input = screen.getByRole('textbox', { name: 'Name' });
    await user.type(input, 'i');
    expect(onChange).toHaveBeenLastCalledWith('Ali');
    expect((input as HTMLInputElement).value).toBe('Al');
    await user.tab();
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it('disables its control', () => {
    render(<Field label="Name" value="Alice" disabled onChange={noop} />);
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('describes its control by a hint, and by an error that also marks it invalid', () => {
    render(<Field label="Name" value="" hint="As it appears in the manuscript" error="A name is required" onChange={noop} />);
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(expect.arrayContaining(['As it appears in the manuscript', 'A name is required']));
    expect(danglingAriaReferences()).toEqual([]);
  });

  it('is not invalid and has nothing to describe it without a hint or an error', () => {
    render(<Field label="Name" value="Alice" onChange={noop} />);
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});
