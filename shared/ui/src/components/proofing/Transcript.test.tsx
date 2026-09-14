// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Transcript } from './Transcript';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TRANSCRIPT } from '../../api/wireframeFixture';

afterEach(cleanup);

describe('Transcript vocabulary suggestions', () => {
  it('does not show candidates until requested, then accepts manifest candidates once', async () => {
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <Transcript state={WIRE_TRANSCRIPT} notify={vi.fn()} goHome={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    await screen.findByText('Vocabulary hints');
    expect(screen.queryByRole('button', { name: /\+ Alice/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Suggest from manuscript/ }));
    const alice = await screen.findByRole('button', { name: /\+ Alice/ });
    fireEvent.click(alice);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Suggest from manuscript/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /\+ Alice/ })).toBeNull());
  });
});
