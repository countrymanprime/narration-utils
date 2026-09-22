// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { CreditsPanel } from './CreditsPanel';

afterEach(cleanup);

function renderPanel() {
  const api = createMockApi();
  const notify = vi.fn();
  render(
    <ApiProvider api={api}>
      <CreditsPanel notify={notify} />
    </ApiProvider>,
  );
  return { api, notify };
}

describe('CreditsPanel', () => {
  it('loads the shipped default templates into the picker, selecting the first one', async () => {
    renderPanel();
    const select = (await screen.findByRole('combobox', { name: 'Template' })) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThanOrEqual(3));
    expect(select.value).toBeTruthy();
  });

  it('previews the selected template with an unresolved-token chip and count before any project value is set', async () => {
    renderPanel();
    expect(await screen.findByText(/unresolved token/)).toBeTruthy();
    expect(screen.getByText('[Title]')).toBeTruthy();
  });

  it('fills the preview and drops the unresolved count once matching project values are saved', async () => {
    renderPanel();
    await screen.findByText(/unresolved token/);
    const titleField = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(titleField, { target: { value: 'Bad Ideas Look Great in Neon' } });
    fireEvent.blur(titleField);
    await waitFor(() => expect(screen.queryByText('[Title]')).toBeNull());
    expect(await screen.findByText(/Bad Ideas Look Great in Neon/)).toBeTruthy();
  });

  it('offers the manuscript-seeded suggestion for an empty Title field, and accepting it saves the value', async () => {
    renderPanel();
    const suggestions = await screen.findAllByText(/Suggested from the manuscript/);
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Use suggestion' })[0]);
    await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).not.toBe(''));
  });

  it('saves a new template only once its body or name changed, and adds it to the library', async () => {
    const { api } = renderPanel();
    await screen.findByRole('combobox', { name: 'Template' });
    const saveButton = screen.getByRole('button', { name: 'Save template' });
    expect(saveButton).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: '[Title], read by [Narrator].' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(async () => expect((await api.creditsTemplates()).some((template) => template.body === '[Title], read by [Narrator].')).toBe(true));
  });
});
