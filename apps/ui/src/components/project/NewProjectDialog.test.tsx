// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewProjectDialog } from './NewProjectDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';

afterEach(cleanup);

function renderDialog(overrides: Parameters<typeof createMockApi>[0] = {}) {
  const api = createMockApi(overrides);
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <ApiProvider api={api}>
      <NewProjectDialog onClose={onClose} onCreated={onCreated} />
    </ApiProvider>,
  );
  return { api, onClose, onCreated };
}

describe('NewProjectDialog', () => {
  it('is a dialog titled New Project with a Name field focused', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'New Project' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBe(document.activeElement);
  });

  it('disables Create until a name is entered', () => {
    renderDialog();
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });

    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('creates the project with an empty parent by default, defaulting to the Phase 1 projects directory', async () => {
    const createProject = vi.fn(async () => ({ switched: true }));
    const { onCreated } = renderDialog({ createProject });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith('', 'Alice'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ switched: true }));
  });

  it('trims surrounding whitespace from the name before creating', async () => {
    const createProject = vi.fn(async () => ({ switched: true }));
    renderDialog({ createProject });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Alice  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith('', 'Alice'));
  });

  it('uses the folder chosen through Change location as the parent', async () => {
    const createProject = vi.fn(async () => ({ switched: true }));
    const selectProjectFolder = vi.fn(async () => ({ selected: true, path: 'C:/Elsewhere' }));
    renderDialog({ createProject, selectProjectFolder });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });

    fireEvent.click(screen.getByRole('button', { name: /Change location/ }));
    await waitFor(() => expect(selectProjectFolder).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith('C:/Elsewhere', 'Alice'));
  });

  it('leaves the parent unchanged when Change location is cancelled', async () => {
    const createProject = vi.fn(async () => ({ switched: true }));
    const selectProjectFolder = vi.fn(async () => ({ selected: false }));
    renderDialog({ createProject, selectProjectFolder });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });

    fireEvent.click(screen.getByRole('button', { name: /Change location/ }));
    await waitFor(() => expect(selectProjectFolder).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith('', 'Alice'));
  });

  it('shows a refusal reason and does not close when the create is refused', async () => {
    const createProject = vi.fn(async () => ({ switched: false, reason: 'Narration Utils is busy.' }));
    const { onCreated, onClose } = renderDialog({ createProject });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Narration Utils is busy.')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces a rejected create call as visible text instead of failing silently', async () => {
    const createProject = vi.fn(async () => {
      throw new Error('the desktop host is not ready');
    });
    renderDialog({ createProject });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Error: the desktop host is not ready')).toBeTruthy();
  });

  it('calls onClose when Cancel is clicked', () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
  });
});
