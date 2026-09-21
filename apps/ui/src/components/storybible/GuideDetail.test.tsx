// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_ENTITIES } from '../../api/mockFixtures';
import { GuideDetail } from './GuideDetail';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

class PreviewAudio {
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);

  constructor(readonly src: string) {}
}

function readyPreviewApi() {
  const api = createMockApi();
  vi.spyOn(api, 'guidePreview').mockResolvedValue({ status: 'ready', audioBase64: 'UklGRg==', mimeType: 'audio/wav' });
  return api;
}

function renderReadyPreview(entity = WIRE_ENTITIES[1]) {
  const previews: PreviewAudio[] = [];
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
  vi.stubGlobal(
    'Audio',
    class extends PreviewAudio {
      constructor(src: string) {
        super(src);
        previews.push(this);
      }
    },
  );
  render(
    <ApiProvider api={readyPreviewApi()}>
      <GuideDetail entity={entity} entities={WIRE_ENTITIES} reload={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} goToManuscript={vi.fn()} />
    </ApiProvider>,
  );
  return previews;
}

function renderDetail(entity: (typeof WIRE_ENTITIES)[number]) {
  render(
    <ApiProvider api={createMockApi()}>
      <GuideDetail entity={entity} entities={WIRE_ENTITIES} reload={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} goToManuscript={vi.fn()} />
    </ApiProvider>,
  );
}

describe('Story Bible locked entries', () => {
  it('offers neither Edit nor Save for a locked entry and keeps its fields read-only', () => {
    const entity = WIRE_ENTITIES.find((row) => row.locked);
    if (!entity) throw new Error('fixture must include a locked entity');
    renderDetail(entity);
    expect((screen.getByDisplayValue(entity.canonical_name) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Edit this entry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes to this entry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete entity' })).toBeNull();
  });
});

describe('Story Bible read-only entries (ADR-0018)', () => {
  const unlocked = () => {
    const entity = WIRE_ENTITIES.find((row) => !row.locked);
    if (!entity) throw new Error('fixture must include an unlocked entity');
    return entity;
  };

  it('opens read-only with no Save button until Edit is clicked', () => {
    const entity = unlocked();
    renderDetail(entity);
    expect((screen.getByDisplayValue(entity.canonical_name) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save changes to this entry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit this entry' })).toBeTruthy();
  });

  it('Edit enables the fields and shows Save and Cancel; Cancel restores read-only', () => {
    const entity = unlocked();
    renderDetail(entity);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    expect((screen.getByDisplayValue(entity.canonical_name) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Save changes to this entry' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect((screen.getByDisplayValue(entity.canonical_name) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save changes to this entry' })).toBeNull();
  });
});

describe('Story Bible local TTS preview', () => {
  it('requires explicit approval before downloading a missing local voice and retries the preview', async () => {
    vi.stubGlobal('Audio', PreviewAudio);
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <GuideDetail
          entity={WIRE_ENTITIES[0]}
          entities={WIRE_ENTITIES}
          reload={vi.fn().mockResolvedValue(undefined)}
          notify={vi.fn()}
          goToManuscript={vi.fn()}
        />
      </ApiProvider>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Play preview' })[0]);
    expect(await screen.findByRole('heading', { name: 'Download local preview voice?' })).toBeTruthy();
    expect(screen.getByText(/LJ Speech/)).toBeTruthy();
    expect(screen.getByText(/109 MB/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Download voice' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /preview voice/i })).toBeNull());
  });

  it('plays a ready preview without rendering a native audio control and toggles pause', async () => {
    const previews = renderReadyPreview();

    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    await waitFor(() => expect(previews).toHaveLength(1));
    expect(previews[0].src).toBe('blob:preview');
    expect(previews[0].play).toHaveBeenCalledTimes(1);
    expect(document.querySelector('audio')).toBeNull();
    // The button flips to Pause only after the audio's play() promise settles, one step after the Audio object exists.
    expect(await screen.findByRole('button', { name: 'Pause preview' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }));
    expect(previews[0].pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    await waitFor(() => expect(previews[0].play).toHaveBeenCalledTimes(2));
  });

  it('says why a preview failed and leaves Play usable for another try', async () => {
    const previews: PreviewAudio[] = [];
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
    vi.stubGlobal(
      'Audio',
      class extends PreviewAudio {
        constructor(src: string) {
          super(src);
          previews.push(this);
        }
      },
    );
    const api = createMockApi();
    const guidePreview = vi
      .spyOn(api, 'guidePreview')
      .mockRejectedValueOnce('"Dawnspire" could not be spoken: the voice produced no audio for it.')
      .mockResolvedValue({ status: 'ready', audioBase64: 'UklGRg==', mimeType: 'audio/wav' });
    const notify = vi.fn();
    render(
      <ApiProvider api={api}>
        <GuideDetail
          entity={WIRE_ENTITIES[1]}
          entities={WIRE_ENTITIES}
          reload={vi.fn().mockResolvedValue(undefined)}
          notify={notify}
          goToManuscript={vi.fn()}
        />
      </ApiProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('"Dawnspire" could not be spoken: the voice produced no audio for it.'));
    const play = screen.getByRole('button', { name: 'Play preview' });
    expect((play as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(play);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause preview' })).toBeTruthy());
    expect(guidePreview).toHaveBeenCalledTimes(2);
    expect(previews).toHaveLength(1);
  });

  it('shows the host failure the mock preview-error seam simulates once the voice is installed', async () => {
    vi.stubGlobal('Audio', PreviewAudio);
    const api = createMockApi({}, { previewError: 'the preview voice could not be loaded (missing file)' });
    await api.ttsInstall('en_US-ljspeech-high');
    const notify = vi.fn();
    render(
      <ApiProvider api={api}>
        <GuideDetail
          entity={WIRE_ENTITIES[1]}
          entities={WIRE_ENTITIES}
          reload={vi.fn().mockResolvedValue(undefined)}
          notify={notify}
          goToManuscript={vi.fn()}
        />
      </ApiProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith('The preview voice could not be loaded (missing file)'));
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeTruthy();
  });

  it('stops the active preview when switching to an alias and clears playback when it ends', async () => {
    const previews = renderReadyPreview();

    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    await waitFor(() => expect(previews).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Play alias pronunciation' }));
    await waitFor(() => expect(previews).toHaveLength(2));

    expect(previews[0].pause).toHaveBeenCalledTimes(1);
    expect(previews[1].play).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Pause alias pronunciation' })).toBeTruthy();

    previews[1].onended?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play alias pronunciation' })).toBeTruthy());
  });
});

describe('Story Bible delete confirmation', () => {
  it('is a red alertdialog that keeps focus inside and hands it back to Delete entity on Escape', async () => {
    const entity = WIRE_ENTITIES.find((row) => !row.locked);
    if (!entity) throw new Error('fixture must include an unlocked entity');
    const user = userEvent.setup();
    renderDetail(entity);
    const opener = screen.getByRole('button', { name: 'Delete entity' });
    await user.click(opener);

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete entry' });
    expect(within(dialog).getByRole('button', { name: 'Delete entry' }).className).toContain('text-[var(--danger-text)]');
    // The page behind is out of the accessibility tree while the dialog is open.
    expect(screen.queryByRole('button', { name: 'Edit this entry' })).toBeNull();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(screen.getByRole('button', { name: 'Edit this entry' })).toBeTruthy();
  });
});
