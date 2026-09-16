// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_ENTITIES } from '../../api/mockFixtures';
import { GuideDetail } from './GuideDetail';

afterEach(cleanup);

describe('Story Bible local TTS preview', () => {
  it('requires explicit approval before downloading a missing local voice and retries the preview', async () => {
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <GuideDetail
          entity={WIRE_ENTITIES[0]}
          entities={WIRE_ENTITIES}
          reload={vi.fn().mockResolvedValue(undefined)}
          notify={vi.fn()}
          select={vi.fn()}
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
});
