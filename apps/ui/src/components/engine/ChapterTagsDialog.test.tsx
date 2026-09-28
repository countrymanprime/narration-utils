// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChapterTagsDialog } from './ChapterTagsDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

function renderDialog(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}, onClose = vi.fn()) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <ChapterTagsDialog onClose={onClose} />
    </ApiProvider>,
  );
  return { api, onClose };
}

describe('ChapterTagsDialog', () => {
  it('says to prepare a chapter render first when none is configured', async () => {
    renderDialog();
    expect(await screen.findByText(/No chapter render is configured yet/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Embed chapter tags' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists the known chapters and requires a destination and the confirm checkbox before embedding', async () => {
    const user = userEvent.setup();
    renderDialog({}, { chapterTags: 'ready' });

    expect(await screen.findByText('Chapter 1')).toBeTruthy();
    expect(screen.getByText('Chapter 2')).toBeTruthy();
    const embedButton = screen.getByRole('button', { name: 'Embed chapter tags' }) as HTMLButtonElement;
    expect(embedButton.disabled).toBe(true);

    await user.type(screen.getByLabelText('Combined book MP3 to add chapters to'), 'C:\\Books\\Alice\\Alice.mp3');
    expect(embedButton.disabled).toBe(true); // still unconfirmed

    await user.click(screen.getByText(/I understand this writes a new file/));
    expect(embedButton.disabled).toBe(false);
  });

  it('embeds and reports the new file path', async () => {
    const user = userEvent.setup();
    const { api } = renderDialog({}, { chapterTags: 'ready' });
    const embedSpy = vi.spyOn(api, 'chapterTagsEmbed');

    await screen.findByText('Chapter 1');
    await user.type(screen.getByLabelText('Combined book MP3 to add chapters to'), 'C:\\Books\\Alice\\Alice.mp3');
    await user.click(screen.getByText(/I understand this writes a new file/));
    await user.click(screen.getByRole('button', { name: 'Embed chapter tags' }));

    await waitFor(() => expect(embedSpy).toHaveBeenCalledWith('C:\\Books\\Alice\\Alice.mp3'));
    expect(await screen.findByText(/Wrote C:\\Books\\Alice\\renders\\Alice in Wonderland\.chapters\.mp3/)).toBeTruthy();
  });

  it('shows a not-rendered chapter and keeps the embed action disabled', async () => {
    renderDialog({}, { chapterTags: 'not-rendered' });
    expect(await screen.findByText('not rendered yet')).toBeTruthy();
    expect(screen.getByText(/Press Render in REAPER first/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Embed chapter tags' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows an error from a failed embed', async () => {
    const user = userEvent.setup();
    renderDialog({}, { chapterTags: 'ready', chapterTagsEmbedAlwaysErrors: true });

    await screen.findByText('Chapter 1');
    await user.type(screen.getByLabelText('Combined book MP3 to add chapters to'), 'C:\\Books\\Alice\\Alice.mp3');
    await user.click(screen.getByText(/I understand this writes a new file/));
    await user.click(screen.getByRole('button', { name: 'Embed chapter tags' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('could not write chapter tags'))).toBe(true);
  });

  it('never touches the source render or per-chapter files - the API surface has no delete or overwrite method for either', () => {
    const { api } = renderDialog();
    const chapterTagsNamed = Object.keys(api).filter((name) => /chapterTags/i.test(name));
    expect(chapterTagsNamed.sort()).toEqual(['chapterTagsEmbed', 'chapterTagsPreview']);
  });
});
