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
  it('is one named group holding the tags, the suggestions and the typing box', () => {
    renderTags({ actions: <button type="button">Suggest</button> });
    const group = screen.getByRole('group', { name: 'Vocabulary hints' });
    expect(within(group).getByRole('button', { name: 'Remove Wonderland' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: '+ Mad Hatter' })).toBeTruthy();
    expect(within(group).getByRole('textbox', { name: 'Add a vocabulary term' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Suggest' })).toBeTruthy();
  });

  it('says when there is nothing, and only then', () => {
    renderTags({ tags: [], suggestions: [] });
    expect(screen.getByText('No hints yet.')).toBeTruthy();
    cleanup();
    renderTags({ tags: [], suggestions: ['Mad Hatter'] });
    expect(screen.queryByText('No hints yet.')).toBeNull();
  });

  it('reports a typed term on Enter and on Add, and empties the box', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderTags();
    const box = screen.getByRole('textbox', { name: 'Add a vocabulary term' }) as HTMLInputElement;
    await user.type(box, 'Dormouse{Enter}');
    expect(onAdd).toHaveBeenLastCalledWith('Dormouse');
    expect(box.value).toBe('');
    await user.type(box, 'March Hare');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenLastCalledWith('March Hare');
    expect(onAdd).toHaveBeenCalledTimes(2);
  });

  it('hands over the text as typed, so the caller can split a list', async () => {
    const { onAdd } = renderTags();
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Add a vocabulary term' }), 'Alice, Dinah{Enter}');
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
});
