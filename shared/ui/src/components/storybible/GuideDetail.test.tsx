// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  vi.spyOn(api, 'guidePreview').mockResolvedValue({ status: 'ready', audioBase64: '', mimeType: 'audio/wav' });
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

describe('Story Bible locked entries', () => {
  it('disables the editable fields and Save button for a locked entry', () => {
    const entity = WIRE_ENTITIES.find((row) => row.locked);
    if (!entity) throw new Error('fixture must include a locked entity');
    render(
      <ApiProvider api={createMockApi()}>
        <GuideDetail entity={entity} entities={WIRE_ENTITIES} reload={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    expect((screen.getByDisplayValue(entity.canonical_name) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save changes to this entry' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Delete entity' })).toBeNull();
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
    expect(screen.getByRole('button', { name: 'Pause preview' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }));
    expect(previews[0].pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    await waitFor(() => expect(previews[0].play).toHaveBeenCalledTimes(2));
  });

  it('stops the active preview when switching to an alias and clears playback when it ends', async () => {
    const previews = renderReadyPreview();

    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    await waitFor(() => expect(previews).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Play alias pronunciation' }));
    await waitFor(() => expect(previews).toHaveLength(2));

    expect(previews[0].pause).toHaveBeenCalledTimes(1);
    expect(previews[1].play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Pause alias pronunciation' })).toBeTruthy();

    previews[1].onended?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play alias pronunciation' })).toBeTruthy());
  });
});
