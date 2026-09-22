// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Home } from './Home';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { MockImportKind } from '../../api/mockImportPreview';
import type { Bootstrap, NarrationApi } from '../../types';

afterEach(cleanup);

// Home with the mock host, at the point the narrator has chosen a manuscript and the host has answered with its preview.
// `prepare` runs before the file is chosen, so a test can spy on the host's answers (the mock keeps its job in its own closure).
async function openReview(prepare: (api: NarrationApi) => void = () => {}, importPreview: MockImportKind = 'docx') {
  const api = createMockApi({}, { noManuscript: true, importPreview });
  prepare(api);
  const data: Bootstrap = await api.bootstrap();
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <Home data={data} go={() => {}} notify={() => {}} goToManuscript={() => {}} refreshBootstrap={async () => {}} />
      </ApiProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Import manuscript' }));
  const dialog = await screen.findByRole('alertdialog', { name: /^Import Alice\./ });
  return { api, dialog: within(dialog) };
}

describe('the import review dialog, as the narrator meets it', () => {
  it('states the format and size, and lists every section the importer found with its kind', async () => {
    const { dialog } = await openReview();
    expect(dialog.getByText(/^DOCX · 221 paragraphs · /)).toBeTruthy();
    const kinds = (title: string) => (dialog.getByRole('combobox', { name: `${title} content type` }) as HTMLSelectElement).value;
    expect(kinds('Chapter One')).toBe('narration');
    expect(kinds('Characters')).toBe('reference');
    expect(kinds('Glossary')).toBe('reference');
    expect(kinds('Front Matter')).toBe('opening');
    expect(dialog.getAllByRole('combobox')).toHaveLength(8);
  });

  it('offers the three kinds a section can be, by their names in the reader', async () => {
    const { dialog } = await openReview();
    const options = within(dialog.getByRole('combobox', { name: 'Chapter One content type' })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Narration chapter', 'Front Matter', 'Reference material']);
  });

  it('shows the character suggestions checked, with their descriptions', async () => {
    const { dialog } = await openReview();
    for (const name of ['Alice', 'The White Rabbit', 'The Duchess'])
      expect(dialog.getByRole('checkbox', { name: new RegExp(`^${name}`) }).getAttribute('aria-checked')).toBe('true');
    expect(dialog.getByText(/A curious girl who follows a White Rabbit/)).toBeTruthy();
  });

  it('commits the sections as they came when nothing was changed, and every suggestion by its id', async () => {
    let commit = vi.fn();
    const { dialog } = await openReview((api) => void (commit = vi.spyOn(api, 'manuscriptImportCommit')));
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit).toHaveBeenCalledWith('mock-import', {
      confirmedReset: false,
      selection: { sectionKinds: undefined, characterCandidateIds: ['candidate-section-0007-001', 'candidate-section-0007-002', 'candidate-section-0007-003'] },
    });
  });

  it('commits a section the narrator reclassified, and leaves the others out of the choices', async () => {
    let commit = vi.fn();
    const { dialog } = await openReview((api) => void (commit = vi.spyOn(api, 'manuscriptImportCommit')));
    fireEvent.change(dialog.getByRole('combobox', { name: 'Glossary content type' }), { target: { value: 'narration' } });
    expect((dialog.getByRole('combobox', { name: 'Glossary content type' }) as HTMLSelectElement).value).toBe('narration');
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit.mock.calls[0]?.[1].selection?.sectionKinds).toEqual({ 'section-0006': 'narration' });
  });

  it('commits only the suggestions that are still checked, as an explicit list', async () => {
    let commit = vi.fn();
    const { dialog } = await openReview((api) => void (commit = vi.spyOn(api, 'manuscriptImportCommit')));
    fireEvent.click(dialog.getByRole('checkbox', { name: /^The White Rabbit/ }));
    expect(dialog.getByRole('checkbox', { name: /^The White Rabbit/ }).getAttribute('aria-checked')).toBe('false');
    expect(dialog.getByRole('checkbox', { name: /^Alice/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit.mock.calls[0]?.[1].selection?.characterCandidateIds).toEqual(['candidate-section-0007-001', 'candidate-section-0007-003']);
  });

  it('checks a suggestion again after it was cleared', async () => {
    const { dialog } = await openReview();
    const rabbit = () => dialog.getByRole('checkbox', { name: /^The White Rabbit/ });
    fireEvent.click(rabbit());
    fireEvent.click(rabbit());
    expect(rabbit().getAttribute('aria-checked')).toBe('true');
  });

  it('a Word file has no chapter heading level to choose', async () => {
    const { dialog } = await openReview();
    expect(dialog.queryByRole('combobox', { name: 'Markdown chapter heading level' })).toBeNull();
  });

  it('a Markdown file starts at H1, and another level reads the file again and drops the choices made for the old sections', async () => {
    let preview = vi.fn();
    let commit = vi.fn();
    const { dialog } = await openReview((api) => {
      preview = vi.spyOn(api, 'manuscriptImportPreview');
      commit = vi.spyOn(api, 'manuscriptImportCommit');
    }, 'markdown');
    const level = () => dialog.getByRole('combobox', { name: 'Markdown chapter heading level' }) as HTMLSelectElement;
    expect(level().value).toBe('1');
    expect(preview).toHaveBeenLastCalledWith('mock-import', { markdownHeadingLevel: 1 });

    fireEvent.change(dialog.getByRole('combobox', { name: 'Glossary content type' }), { target: { value: 'narration' } });
    fireEvent.change(level(), { target: { value: '2' } });
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith('mock-import', { markdownHeadingLevel: 2 }));
    await waitFor(() => expect(level().value).toBe('2'));
    expect((dialog.getByRole('combobox', { name: 'Glossary content type' }) as HTMLSelectElement).value).toBe('reference');

    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit.mock.calls[0]?.[1].selection?.sectionKinds).toBeUndefined();
  });

  it('replacing a manuscript says what is cleared, and the commit is confirmed as a reset', async () => {
    let commit = vi.fn();
    const { dialog } = await openReview((api) => {
      const preview = api.manuscriptImportPreview;
      api.manuscriptImportPreview = async (id, options) => ({ ...(await preview(id, options)), requiresReset: true });
      commit = vi.spyOn(api, 'manuscriptImportCommit');
    });
    expect(dialog.getByText(/This replaces the active manuscript and clears Story Bible/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Replace and reset' }));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit.mock.calls[0]?.[1].confirmedReset).toBe(true);
  });

  it('cancelling asks the host to drop the job and closes the dialog', async () => {
    let cancel = vi.fn();
    const { dialog } = await openReview((api) => void (cancel = vi.spyOn(api, 'manuscriptImportCancel')));
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(cancel).toHaveBeenCalledWith('mock-import');
  });
});
