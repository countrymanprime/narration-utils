// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { IconButton } from './IconButton';

afterEach(cleanup);

describe('Button pending (ADR 0075)', () => {
  it('calls onClick when it is not pending', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('says it is busy, shows a spinner, and ignores a press while pending', () => {
    const onClick = vi.fn();
    render(
      <Button pending onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.querySelector('svg')).not.toBeNull();
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('stays focusable while pending, so a keyboard user keeps their place, and is not a disabled button', () => {
    render(<Button pending>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    expect(document.activeElement).toBe(button);
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not submit a form while pending, and does once it is not', () => {
    const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const { rerender } = render(
      <form onSubmit={submit}>
        <Button type="submit" pending>
          Save
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).not.toHaveBeenCalled();
    rerender(
      <form onSubmit={submit}>
        <Button type="submit">Save</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('carries no busy state and no spinner when it is not pending', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.querySelector('svg')).toBeNull();
  });

  it('spins only for people who have not asked for reduced motion', () => {
    render(<Button pending>Save</Button>);
    const classes = (screen.getByRole('button').querySelector('svg') as SVGElement).getAttribute('class')?.split(/\s+/) ?? [];
    expect(classes).toContain('motion-safe:animate-spin');
    expect(classes).not.toContain('animate-spin');
  });
});

describe('IconButton pending (ADR 0075)', () => {
  it('swaps its icon for a spinner, keeps its name, and ignores a press while pending', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Save changes" pending onClick={onClick}>
        <span data-testid="icon" />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('icon')).toBeNull();
    expect(button.querySelector('svg')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows its icon and calls onClick when it is not pending', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Save changes" onClick={onClick}>
        <span data-testid="icon" />
      </IconButton>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByTestId('icon')).toBeTruthy();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
