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

  it('offers the chapter announcement kind and previews it for the first chapter, filling [Chapter] and [Chapter Title] (Phase 5)', async () => {
    const { api } = renderPanel();
    await screen.findByRole('combobox', { name: 'Template' });
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: 'chapter_announcement' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: '[Chapter]{: [Chapter Title]}.' } });
    expect(await screen.findByText('Chapter 1: Down the Rabbit-Hole.')).toBeTruthy();
    expect(screen.getByText(/Shown for Chapter 1, one of 12 chapters/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(async () => expect((await api.creditsTemplates()).some((template) => template.kind === 'chapter_announcement')).toBe(true));
  });
});

describe('Retail sample (Phase 5, C10)', () => {
  const pick = (name: string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });

  it('saves the range the narrator picks and shows its length, as a marker that adds no time', async () => {
    const { api } = renderPanel();
    const chapter = (await api.manuscriptChapters())[1];
    await screen.findByRole('combobox', { name: 'Sample starts in' });
    pick('Sample starts in', chapter.id);
    pick('Start line', '1');
    pick('Sample ends in', chapter.id);
    pick('End line', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Save sample' }));
    expect(await screen.findByText(/Chapter 2, line 1 to Chapter 2, line 3/)).toBeTruthy();
    expect(screen.getByText(/adds no time to the estimate/)).toBeTruthy();
    expect((await api.creditsRetailSample()).sample).toMatchObject({ startLine: 1, endLine: 3 });
  });

  it('shows the refusal for a range over 5 minutes and keeps nothing', async () => {
    const { api } = renderPanel();
    const chapters = await api.manuscriptChapters();
    await screen.findByRole('combobox', { name: 'Sample starts in' });
    pick('Sample starts in', chapters[0].id);
    pick('Start line', '1');
    pick('Sample ends in', chapters[11].id);
    pick('End line', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Save sample' }));
    expect(await screen.findByText(/at most 5 minutes/)).toBeTruthy();
    expect((await api.creditsRetailSample()).sample).toBeNull();
  });

  it('clears a saved sample', async () => {
    const plain = createMockApi();
    const chapter = (await plain.manuscriptChapters())[1];
    const [first, second] = chapter.paragraphIds ?? [];
    const api = createMockApi({}, { retailSample: { startParagraphId: first.id, endParagraphId: second.id } });
    render(
      <ApiProvider api={api}>
        <CreditsPanel notify={vi.fn()} />
      </ApiProvider>,
    );
    expect(await screen.findByText(/Chapter 2, line 1 to Chapter 2, line 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear sample' }));
    expect(await screen.findByText(/No retail sample picked/)).toBeTruthy();
    expect((await api.creditsRetailSample()).sample).toBeNull();
  });
});
