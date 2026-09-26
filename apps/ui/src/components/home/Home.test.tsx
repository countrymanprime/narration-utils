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

// The character suggestions start folded while every one is checked (nothing to decide), so a test that works on them opens the group.
const openSuggestions = (dialog: ReturnType<typeof within>) => fireEvent.click(dialog.getByRole('button', { name: /^Story Bible character suggestions/ }));

describe('the import review dialog, as the narrator meets it', () => {
  it('states the format and size, and lists every section the importer found with its kind', async () => {
    const { dialog } = await openReview();
    expect(dialog.getByText(/^DOCX · 221 paragraphs · /)).toBeTruthy();
    const kinds = (title: string) => (dialog.getByRole('combobox', { name: `${title} content type` }) as HTMLSelectElement).value;
    expect(kinds('Chapter One — Down the Rabbit-Hole')).toBe('narration');
    expect(kinds('Characters')).toBe('reference');
    expect(kinds('Glossary')).toBe('reference');
    expect(kinds('Front Matter')).toBe('opening');
    expect(dialog.getAllByRole('combobox')).toHaveLength(8);
  });

  it('offers the three kinds a section can be, by their names in the reader', async () => {
    const { dialog } = await openReview();
    const options = within(dialog.getByRole('combobox', { name: 'Chapter One — Down the Rabbit-Hole content type' })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Narration chapter', 'Front Matter', 'Reference material']);
  });

  it('shows the character suggestions checked, with their descriptions', async () => {
    const { dialog } = await openReview();
    openSuggestions(dialog);
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

  it('commits the subtitles the narrator turned off, by the default and by a row, as false for each section', async () => {
    let commit = vi.fn();
    const { dialog } = await openReview((api) => void (commit = vi.spyOn(api, 'manuscriptImportCommit')));
    fireEvent.click(dialog.getByRole('checkbox', { name: "Read a heading's second line as its subtitle" }));
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Subtitle — The Pool of Tears' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit.mock.calls[0]?.[1].selection?.subtitleOverrides).toEqual({ 'section-0001': false, 'section-0004': false });
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
    openSuggestions(dialog);
    fireEvent.click(dialog.getByRole('checkbox', { name: /^The White Rabbit/ }));
    expect(dialog.getByRole('checkbox', { name: /^The White Rabbit/ }).getAttribute('aria-checked')).toBe('false');
    expect(dialog.getByRole('checkbox', { name: /^Alice/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit.mock.calls[0]?.[1].selection?.characterCandidateIds).toEqual(['candidate-section-0007-001', 'candidate-section-0007-003']);
  });

  it('checks a suggestion again after it was cleared', async () => {
    const { dialog } = await openReview();
    openSuggestions(dialog);
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

describe('build after import (B1-B3)', () => {
  it('offers the checkbox pre-checked from Settings (ManuscriptGuide.build_after_import defaults on, D8)', async () => {
    const { dialog } = await openReview();
    const box = await waitFor(() => dialog.getByRole('checkbox', { name: 'Build the Story Bible after import' }));
    expect(box.getAttribute('aria-checked')).toBe('true');
  });

  it('chains a build after a successful import, saying so, and never blames the import for a build failure', async () => {
    let guideBuild = vi.fn();
    const notices: string[] = [];
    const api = createMockApi({}, { noManuscript: true });
    guideBuild = vi.spyOn(api, 'guideBuild').mockRejectedValue(new Error('the language model could not be read'));
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <Home data={await api.bootstrap()} go={() => {}} notify={(text) => notices.push(text)} goToManuscript={() => {}} refreshBootstrap={async () => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Import manuscript' }));
    const dialog = within(await screen.findByRole('alertdialog', { name: /^Import Alice\./ }));
    await waitFor(() => dialog.getByRole('checkbox', { name: 'Build the Story Bible after import' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(guideBuild).toHaveBeenCalledWith({}));
    await waitFor(() => expect(notices).toContain('Manuscript imported.'));
    await waitFor(() => expect(notices.some((text) => text.includes('Story Bible build failed: the language model could not be read'))).toBe(true));
    // The import itself is never in question: no dialog is left open demanding another look.
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not chain a build when the narrator unchecks it', async () => {
    let guideBuild = vi.fn();
    const { dialog } = await openReview((api) => void (guideBuild = vi.spyOn(api, 'guideBuild')));
    const box = await waitFor(() => dialog.getByRole('checkbox', { name: 'Build the Story Bible after import' }));
    fireEvent.click(box);
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(guideBuild).not.toHaveBeenCalled();
  });

  it('shows the chained build as its own progress dialog when it does not finish at once', async () => {
    const { dialog, api } = await openReview((hostApi) =>
      vi.spyOn(hostApi, 'guideBuild').mockResolvedValue({
        status: 'started',
        job: { id: 'chained-build', kind: 'story_bible', phase: 'running', message: 'Extracting names', percent: 30, logs: [], elapsed: 3 },
      }),
    );
    vi.spyOn(api, 'guideBuildState').mockResolvedValue({
      id: 'chained-build',
      kind: 'story_bible',
      phase: 'running',
      message: 'Extracting names',
      percent: 30,
      logs: [],
      elapsed: 3,
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('dialog', { name: 'Build the Story Bible' })).toBeTruthy();
  });

  // The chained build's dialog closes by itself on the host's success, as the Story Bible page's rebuild dialog does (ADR 0076).
  it('closes the chained build dialog by itself once the host reports the build done', async () => {
    const running = {
      id: 'chained-build',
      kind: 'story_bible' as const,
      phase: 'running' as const,
      message: 'Extracting names',
      percent: 30,
      logs: [],
      elapsed: 3,
    };
    const { dialog, api } = await openReview((hostApi) => vi.spyOn(hostApi, 'guideBuild').mockResolvedValue({ status: 'started', job: running }));
    let calls = 0;
    vi.spyOn(api, 'guideBuildState').mockImplementation(async () => ({ ...running, phase: ++calls < 3 ? 'running' : 'success' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    await screen.findByRole('dialog', { name: 'Build the Story Bible' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Build the Story Bible' })).toBeNull(), { timeout: 3000 });
  });

  // The same build started from the Story Bible page can go on in the background (ADR 0076); the chained one does not hold the narrator either.
  it('lets the narrator send the chained build to the background, and stops following it', async () => {
    const running = {
      id: 'chained-build',
      kind: 'story_bible' as const,
      phase: 'running' as const,
      message: 'Extracting names',
      percent: 30,
      logs: [],
      elapsed: 3,
    };
    const { dialog, api } = await openReview((hostApi) => vi.spyOn(hostApi, 'guideBuild').mockResolvedValue({ status: 'started', job: running }));
    const state = vi.spyOn(api, 'guideBuildState').mockResolvedValue(running);
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    const build = await screen.findByRole('dialog', { name: 'Build the Story Bible' });
    expect(within(build).getByText(/keeps running/)).toBeTruthy();
    fireEvent.click(within(build).getByRole('button', { name: 'Continue in background' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Build the Story Bible' })).toBeNull());
    const polls = state.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(state.mock.calls.length).toBe(polls);
  });

  it('keeps the chained build dialog open with the reason when asking the host how far it is fails', async () => {
    const running = {
      id: 'chained-build',
      kind: 'story_bible' as const,
      phase: 'running' as const,
      message: 'Extracting names',
      percent: 30,
      logs: [],
      elapsed: 3,
    };
    const { dialog, api } = await openReview((hostApi) => vi.spyOn(hostApi, 'guideBuild').mockResolvedValue({ status: 'started', job: running }));
    vi.spyOn(api, 'guideBuildState').mockRejectedValue(new Error('the host stopped answering'));
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));
    const build = await screen.findByRole('dialog', { name: 'Build the Story Bible' });
    expect(await within(build).findAllByText(/the host stopped answering/)).not.toHaveLength(0);
  });
});

describe('the summary and the groups of the review', () => {
  it('says in the dialog message what was found, and follows a reclassification', async () => {
    const { dialog } = await openReview();
    expect(dialog.getByText(/^DOCX · 221 paragraphs · 5 narration chapters\./)).toBeTruthy();
    expect(dialog.getByText('1 front matter section · 2 reference sections · 3 of 3 character suggestions checked')).toBeTruthy();
    fireEvent.change(dialog.getByRole('combobox', { name: 'Glossary content type' }), { target: { value: 'narration' } });
    expect(dialog.getByText(/^DOCX · 221 paragraphs · 6 narration chapters\./)).toBeTruthy();
    expect(dialog.getByText('1 front matter section · 1 reference section · 3 of 3 character suggestions checked')).toBeTruthy();
  });

  it('keeps the groups the narrator folded when another Markdown heading level is read', async () => {
    const { dialog } = await openReview(() => {}, 'markdown');
    fireEvent.click(dialog.getByRole('button', { name: /^Narration chapters/ }));
    expect(dialog.queryByRole('combobox', { name: 'Chapter Three content type' })).toBeNull();
    fireEvent.change(dialog.getByRole('combobox', { name: 'Markdown chapter heading level' }), { target: { value: '2' } });
    await waitFor(() => expect((dialog.getByRole('combobox', { name: 'Markdown chapter heading level' }) as HTMLSelectElement).value).toBe('2'));
    expect(dialog.getByRole('button', { name: /^Narration chapters/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('starts every group from its default, with no earlier choices, when another file is chosen', async () => {
    const { dialog } = await openReview();
    fireEvent.click(dialog.getByRole('button', { name: /^Narration chapters/ }));
    fireEvent.change(dialog.getByRole('combobox', { name: 'Glossary content type' }), { target: { value: 'narration' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Import manuscript' }));
    const again = within(await screen.findByRole('alertdialog', { name: /^Import Alice\./ }));
    expect(again.getByRole('button', { name: /^Narration chapters 5 chapters/ }).getAttribute('aria-expanded')).toBe('true');
    expect((again.getByRole('combobox', { name: 'Glossary content type' }) as HTMLSelectElement).value).toBe('reference');
  });

  it('has no preview activity, and says what the importer repaired', async () => {
    const { dialog } = await openReview(() => {}, 'repaired');
    expect(dialog.queryByText('Preview activity')).toBeNull();
    expect(dialog.queryByRole('progressbar')).toBeNull();
    expect(dialog.getByText(/2 repairs made to the source/)).toBeTruthy();
    expect(dialog.getByText(/CHAPTER TWOThe Pool of Tears/)).toBeTruthy();
  });
});

describe('the subtitle of each chapter in the review', () => {
  it('shows the subtitle of a chapter after its title, and only its title when the heading had none', async () => {
    const { dialog } = await openReview();
    expect(dialog.getByText('Chapter One').closest('[title]')!.textContent).toBe('Chapter One — Down the Rabbit-Hole');
    expect(dialog.getByText('Chapter Two').closest('[title]')!.textContent).toBe('Chapter Two — The Pool of Tears');
    expect(dialog.getByText('Chapter Three').closest('[title]')!.textContent).toBe('Chapter Three');
  });

  it('keeps the whole title and subtitle in the title attribute of the row, for a name cut short', async () => {
    const { dialog } = await openReview();
    expect(dialog.getByText('Chapter One').closest('[title]')!.getAttribute('title')).toBe('Chapter One — Down the Rabbit-Hole');
    expect(dialog.getByText('Chapter Three').closest('[title]')!.getAttribute('title')).toBe('Chapter Three');
  });

  it('names the select of a row for the subtitle too, so two chapters with one title can be told apart', async () => {
    const { dialog } = await openReview();
    expect(dialog.getByRole('combobox', { name: 'Chapter Two — The Pool of Tears content type' })).toBeTruthy();
    expect(dialog.getByRole('combobox', { name: 'Chapter Three content type' })).toBeTruthy();
  });
});

describe('the Proofing card and a linked DAW file (PRD project-workspace-and-daw-link.prd.md, W16)', () => {
  // The mock's default `transcriptLastCompleted` already has a completed comparison, so "review latest comparison"
  // would stay reachable regardless of the DAW link - override it to nothing-to-review to isolate the Start gate.
  async function renderHome(dawFileLinked: boolean) {
    const api = createMockApi({ transcriptLastCompleted: async () => undefined }, { dawFileLinked });
    const data: Bootstrap = await api.bootstrap();
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <Home data={data} go={() => {}} notify={() => {}} goToManuscript={() => {}} refreshBootstrap={async () => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
  }

  it('disables the Proofing card with a reason that names the missing DAW link when there is nothing to review yet', async () => {
    await renderHome(false);
    const button = await screen.findByRole('button', { name: 'Open Proofing' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
  });

  it('enables the Proofing card once a DAW file is linked', async () => {
    await renderHome(true);
    const button = await screen.findByRole('button', { name: 'Open Proofing' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the Proofing card open for reviewing an existing comparison even without a linked DAW file', async () => {
    const api = createMockApi({}, { dawFileLinked: false });
    const data: Bootstrap = await api.bootstrap();
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <Home data={data} go={() => {}} notify={() => {}} goToManuscript={() => {}} refreshBootstrap={async () => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    const button = await screen.findByRole('button', { name: 'Open Proofing' });
    await waitFor(() => expect(button.textContent).toContain('Review latest comparison'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('the "Set up the credits" prompt (credits-token-setup-and-front-matter-detection.prd.md, Phase 2)', () => {
  async function renderHome(overrides: Partial<NarrationApi> = {}) {
    const api = createMockApi(overrides, { creditsSetup: true });
    const data: Bootstrap = await api.bootstrap();
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <Home data={data} go={() => {}} notify={() => {}} goToManuscript={() => {}} refreshBootstrap={async () => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    return { api };
  }

  it('shows the dialog on first load when the host reports it is needed', async () => {
    await renderHome();
    expect(await screen.findByRole('dialog', { name: 'Set up the credits' })).toBeTruthy();
  });

  it('does not show the dialog when the host reports nothing is needed (the default mock boot)', async () => {
    const api = createMockApi({}, {});
    const data: Bootstrap = await api.bootstrap();
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <Home data={data} go={() => {}} notify={() => {}} goToManuscript={() => {}} refreshBootstrap={async () => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Replace manuscript' });
    expect(screen.queryByRole('dialog', { name: 'Set up the credits' })).toBeNull();
  });

  it('drops the dialog once Save answers "needed: false"', async () => {
    await renderHome();
    const dialog = within(await screen.findByRole('dialog', { name: 'Set up the credits' }));
    // Title and Author come prefilled from the mock's detected candidates; Narrator has none (no global default in
    // this seed), so it stays unresolved - and the dialog stays open - unless it is typed in.
    fireEvent.change(dialog.getByLabelText('Narrator'), { target: { value: 'Ada Finch' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set up the credits' })).toBeNull());
  });

  it('drops the dialog once "Not now" dismisses it for the session', async () => {
    await renderHome();
    await screen.findByRole('dialog', { name: 'Set up the credits' });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set up the credits' })).toBeNull());
  });

  it('holds back while the manuscript-candidate offer is on screen, so the two dialogs never stack', async () => {
    const api = createMockApi({}, { creditsSetup: true, manuscriptCandidate: { path: '/tmp/book.docx', name: 'book.docx' } });
    const data: Bootstrap = await api.bootstrap();
    render(
      <MemoryRouter>
        <ApiProvider api={api}>
          <Home data={data} go={() => {}} notify={() => {}} goToManuscript={() => {}} refreshBootstrap={async () => {}} />
        </ApiProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('alertdialog', { name: 'Import manuscript?' });
    expect(screen.queryByRole('dialog', { name: 'Set up the credits' })).toBeNull();
  });
});
