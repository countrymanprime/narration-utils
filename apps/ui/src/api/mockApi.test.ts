import { describe, expect, it } from 'vitest';
import { createMockApi } from './mockApi';

// createMockApi() is the mock host used by the browser demo and by most component tests (imported by
// ApiProvider). Its credits functions are a JS mirror of apps/desktop/internal/credits.Render (PRD
// audiobook-credits-templates.prd.md, Open Questions C5/C6), and its install-job and template-library edge
// cases are otherwise only reached indirectly, if at all, through component tests. These exercise that
// behavior directly, against the public NarrationApi surface, rather than through a rendered component.

describe('mockApi credits preview (renderMockCredits)', () => {
  it('keeps an optional {…} segment, with its own punctuation, when every token inside it resolves', async () => {
    const api = createMockApi();
    await api.saveCreditsProjectValues({ title: 'Bad Ideas Look Great in Neon', author: 'A. Writer', narrator: 'Sam' });

    const result = await api.creditsPreview('[Title], written by [Author]{, narrated by [Narrator]}.');

    expect(result.text).toBe('Bad Ideas Look Great in Neon, written by A. Writer, narrated by Sam.');
    expect(result.unresolved).toEqual([]);
  });

  it('drops an optional {…} segment whole, its punctuation included, when a token inside it is unresolved', async () => {
    const api = createMockApi();
    await api.saveCreditsProjectValues({ title: 'Neon', author: 'A. Writer' });

    const result = await api.creditsPreview('[Title], written by [Author]{, narrated by [Narrator]}.');

    // The dropped segment's own token never counts as unresolved: it was optional, not missing (Open Question C6).
    expect(result.text).toBe('Neon, written by A. Writer.');
    expect(result.unresolved).toEqual([]);
  });

  it('still reports an unresolved token outside any optional segment', async () => {
    const api = createMockApi();
    await api.saveCreditsProjectValues({ author: 'A. Writer' });

    const result = await api.creditsPreview('[Title], written by [Author].');

    expect(result.text).toBe('[Title], written by A. Writer.');
    expect(result.unresolved).toEqual(['Title']);
  });

  it('treats an unterminated "{" as literal text, still resolving tokens around it', async () => {
    const api = createMockApi();
    await api.saveCreditsProjectValues({ author: 'A. Writer' });

    const result = await api.creditsPreview('By [Author] {');

    expect(result.text).toBe('By A. Writer {');
    expect(result.unresolved).toEqual([]);
  });

  it('falls back to the global narrator default when the project has not set its own narrator', async () => {
    const api = createMockApi();
    await api.saveSettings('General', 'global', { narrator_name: 'Global Narrator' });
    await api.saveCreditsProjectValues({ title: 'Neon' });

    const result = await api.creditsPreview('[Title], read by [Narrator].');

    expect(result.text).toBe('Neon, read by Global Narrator.');
  });
});

describe('mockApi credit template library', () => {
  it('updates a template in place when its id already exists in the library', async () => {
    const api = createMockApi();
    const [first] = await api.creditsTemplates();

    const updated = await api.saveCreditsTemplate(first.id, first.kind, 'Renamed', 'New body [Title].');

    expect(updated).toEqual({ id: first.id, kind: first.kind, name: 'Renamed', body: 'New body [Title].', builtIn: first.builtIn });
    const templates = await api.creditsTemplates();
    expect(templates.find((template) => template.id === first.id)).toEqual(updated);
  });

  it('adds a new entry, not builtIn, when saved with an id the library does not have (a stale or foreign id)', async () => {
    const api = createMockApi();

    const saved = await api.saveCreditsTemplate('not-in-the-library', 'closing', 'Custom', '[Title].');

    expect(saved).toEqual({ id: 'not-in-the-library', kind: 'closing', name: 'Custom', body: '[Title].', builtIn: false });
    const templates = await api.creditsTemplates();
    expect(templates.some((template) => template.id === 'not-in-the-library')).toBe(true);
  });

  it('duplicates an existing template as a new, editable "<name> copy" entry', async () => {
    const api = createMockApi();
    const [first] = await api.creditsTemplates();

    const duplicate = await api.duplicateCreditsTemplate(first.id);

    expect(duplicate).toMatchObject({ kind: first.kind, name: `${first.name} copy`, body: first.body, builtIn: false });
    expect(duplicate.id).not.toBe(first.id);
  });

  it('rejects duplicating a template id that is not in the library', async () => {
    const api = createMockApi();
    await expect(api.duplicateCreditsTemplate('nope')).rejects.toThrow('No credit template with id "nope"');
  });

  it('removes a template from the library', async () => {
    const api = createMockApi();
    const [first] = await api.creditsTemplates();

    await api.deleteCreditsTemplate(first.id);

    const templates = await api.creditsTemplates();
    expect(templates.some((template) => template.id === first.id)).toBe(false);
  });
});

describe('mockApi asset install edge cases (createInstallMock)', () => {
  it('joins an already-running install instead of starting a second one', async () => {
    const api = createMockApi();

    const first = await api.ttsInstall('en_US-ljspeech-high');
    const second = await api.ttsInstall('en_US-ljspeech-high');

    expect(second).toEqual(first);
  });

  it('rejects polling an unknown or already-finished-elsewhere install job id', async () => {
    const api = createMockApi();
    await expect(api.ttsInstallState('never-started')).rejects.toThrow('unknown voice install job');
  });

  it('rejects cancelling an unknown install job id', async () => {
    const api = createMockApi();
    await expect(api.ttsInstallCancel('never-started')).rejects.toThrow('unknown voice install job');
  });

  it('leaves an already-finished install job alone when asked to advance again', async () => {
    const api = createMockApi();
    const started = await api.ttsInstall('en_US-ljspeech-high');
    // Advance to 'success' and then poll once more: the mock's advance() falls through unchanged once a job is done.
    let state = await api.ttsInstallState(started.id);
    for (let guard = 0; guard < 10 && state.phase !== 'success'; guard += 1) state = await api.ttsInstallState(started.id);
    expect(state.phase).toBe('success');

    const polledAgain = await api.ttsInstallState(started.id);

    expect(polledAgain.phase).toBe('success');
  });
});
