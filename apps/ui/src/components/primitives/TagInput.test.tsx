// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagInput } from './TagInput';

afterEach(cleanup);

function renderTags(overrides: Partial<Parameters<typeof TagInput>[0]> = {}) {
  const handlers = { onAdd: vi.fn(), onRemove: vi.fn(), onAcceptSuggestion: vi.fn() };
  render(
    <TagInput
      label="Vocabulary hints"
      inputLabel="Add a vocabulary term"
      placeholder="Add a term…"
      tags={['Wonderland', 'Cheshire']}
      suggestions={['Mad Hatter']}
      emptyText="No hints yet."
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('TagInput', () => {
  it('is one named group holding the tags, the suggestions and the typing box, with no separate Add row', () => {
    renderTags({ actions: <button type="button">Suggest</button> });
    const group = screen.getByRole('group', { name: 'Vocabulary hints' });
    expect(within(group).getByRole('button', { name: 'Remove Wonderland' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: '+ Mad Hatter' })).toBeTruthy();
    expect(within(group).getByRole('textbox', { name: 'Add a vocabulary term' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Suggest' })).toBeTruthy();
    expect(within(group).queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('says when there is nothing, and only then', () => {
    renderTags({ tags: [], suggestions: [] });
    expect(screen.getByText('No hints yet.')).toBeTruthy();
    cleanup();
    renderTags({ tags: [], suggestions: ['Mad Hatter'] });
    expect(screen.queryByText('No hints yet.')).toBeNull();
  });

  it('hides the empty-box text once a draft is typed, so it never reads as one run-on sentence with it', () => {
    renderTags({ tags: [], suggestions: [] });
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' });
    expect(screen.getByText('No hints yet.')).toBeTruthy();
    fireEvent.change(box, { target: { value: 'D' } });
    expect(screen.queryByText('No hints yet.')).toBeNull();
  });

  it('reports a typed term on Enter, and empties the box', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderTags();
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' }) as HTMLInputElement;
    await user.type(box, 'Dormouse{Enter}');
    expect(onAdd).toHaveBeenLastCalledWith('Dormouse');
    expect(box.value).toBe('');
  });

  it('hands over the text as typed, so the caller can split a list', () => {
    const { onAdd } = renderTags();
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' });
    // A blob set in one go (as a real paste-then-review or a controlled fill would), not typed key by key,
    // so the mid-string comma never reaches the comma-commit handler below.
    fireEvent.change(box, { target: { value: 'Alice, Dinah' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith('Alice, Dinah');
  });

  it('does not report a blank term, and empties the box of it', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderTags();
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' }) as HTMLInputElement;
    await user.type(box, '   {Enter}');
    expect(onAdd).not.toHaveBeenCalled();
    expect(box.value).toBe('');
  });

  it('reports a removed tag and returns the cursor to the typing box', async () => {
    const { onRemove } = renderTags();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove Cheshire' }));
    expect(onRemove).toHaveBeenCalledWith('Cheshire');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Add a vocabulary term' }));
  });

  it('says a suggestion is only suggested, to a screen reader as well as in the hint', () => {
    renderTags();
    expect(screen.getByRole('button', { name: '+ Mad Hatter' }).getAttribute('aria-description')).toBe('Suggested — click to accept');
  });

  it('does not add on an Enter that ends an input-method composition', () => {
    const { onAdd } = renderTags();
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' });
    fireEvent.change(box, { target: { value: 'にほん' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('reports an accepted suggestion', async () => {
    const { onAcceptSuggestion } = renderTags();
    await userEvent.setup().click(screen.getByRole('button', { name: '+ Mad Hatter' }));
    expect(onAcceptSuggestion).toHaveBeenCalledWith('Mad Hatter');
  });

  it('never submits an enclosing form by pressing Enter, a cross or a chip', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <TagInput
          label="Hints"
          inputLabel="Add a term"
          tags={['A']}
          suggestions={['B']}
          emptyText=""
          onAdd={() => undefined}
          onRemove={() => undefined}
          onAcceptSuggestion={() => undefined}
        />
      </form>,
    );
    await user.type(screen.getByRole('textbox', { name: 'Add a term' }), 'x{Enter}');
    await user.click(screen.getByRole('button', { name: 'Remove A' }));
    await user.click(screen.getByRole('button', { name: '+ B' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('commits on a typed comma as well as Enter, and never types the comma itself', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderTags({ tags: [], suggestions: [] });
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' }) as HTMLInputElement;
    await user.type(box, 'Alice,');
    expect(onAdd).toHaveBeenLastCalledWith('Alice');
    expect(box.value).toBe('');
  });

  it('commits the draft on blur, so Start (or any other click) sees the term that was just typed', () => {
    const { onAdd } = renderTags({ tags: [], suggestions: [] });
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' });
    fireEvent.change(box, { target: { value: 'Zeph' } });
    fireEvent.blur(box);
    expect(onAdd).toHaveBeenCalledWith('Zeph');
  });

  it('does not report a blank draft on blur', () => {
    const { onAdd } = renderTags();
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' });
    fireEvent.blur(box);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('removes the last tag on Backspace in an empty box (ADR 0363), and never while there is draft text', () => {
    const { onRemove } = renderTags();
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'x' } });
    fireEvent.keyDown(box, { key: 'Backspace' });
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: '' } });
    fireEvent.keyDown(box, { key: 'Backspace' });
    expect(onRemove).toHaveBeenCalledWith('Cheshire');
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('does nothing on Backspace in an empty box with no tags', () => {
    const { onRemove } = renderTags({ tags: [], suggestions: [] });
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' });
    fireEvent.keyDown(box, { key: 'Backspace' });
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('commits a paste containing a comma or newline at once, instead of leaving it to sit as draft text', () => {
    const { onAdd } = renderTags({ tags: [], suggestions: [] });
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' }) as HTMLInputElement;
    const clipboardData = { getData: () => 'Juno, Zeph' };
    fireEvent.paste(box, { clipboardData });
    expect(onAdd).toHaveBeenCalledWith('Juno, Zeph');
    expect(box.value).toBe('');
  });

  it('leaves an ordinary single-term paste as draft text, uncommitted', () => {
    const { onAdd } = renderTags({ tags: [], suggestions: [] });
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' });
    const clipboardData = { getData: () => 'Juno' };
    fireEvent.paste(box, { clipboardData });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('caps a typed term at 64 characters', async () => {
    const user = userEvent.setup();
    renderTags({ tags: [], suggestions: [] });
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' }) as HTMLInputElement;
    await user.type(box, 'x'.repeat(80));
    expect(box.value).toHaveLength(64);
  });
});
