// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectPicker } from './ProjectPicker';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';

afterEach(cleanup);

function renderPicker(overrides: Parameters<typeof createMockApi>[0] = {}) {
  const api = createMockApi(overrides);
  render(
    <ApiProvider api={api}>
      <ProjectPicker />
    </ApiProvider>,
  );
  return api;
}

describe('ProjectPicker', () => {
  it('is a page of its own: a main landmark with the level-1 heading (axe: landmark-one-main, page-has-heading-one)', () => {
    renderPicker();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Open a project' })).toBeTruthy();
  });

  it('lists seeded recent projects and switches to the one clicked', async () => {
    const api = renderPicker();
    const switchProject = vi.spyOn(api, 'switchProject');
    await waitFor(() => expect(screen.getByText('Voltage and the Undercroft')).toBeTruthy());

    fireEvent.click(screen.getByText('Voltage and the Undercroft'));

    await waitFor(() => expect(switchProject).toHaveBeenCalledWith('C:/Projects/Voltage-and-the-Undercroft', 'Voltage and the Undercroft'));
  });

  it('switches to the folder chosen through Browse', async () => {
    const api = renderPicker({ selectProjectFolder: async () => ({ selected: true, path: 'C:/Projects/New-Project' }) });
    const switchProject = vi.spyOn(api, 'switchProject');
    await waitFor(() => screen.getByRole('button', { name: /Browse/ }));

    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));

    await waitFor(() => expect(switchProject).toHaveBeenCalledWith('C:/Projects/New-Project'));
  });

  it('does nothing when Browse is cancelled', async () => {
    const selectProjectFolder = vi.fn(async () => ({ selected: false }));
    const api = renderPicker({ selectProjectFolder });
    const switchProject = vi.spyOn(api, 'switchProject');
    const createProject = vi.spyOn(api, 'createProject');
    await waitFor(() => screen.getByRole('button', { name: /Browse/ }));

    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));

    await waitFor(() => expect(selectProjectFolder).toHaveBeenCalled());
    expect(switchProject).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('opens the New Project dialog through the Create new flow, instead of switching', async () => {
    const api = renderPicker();
    const switchProject = vi.spyOn(api, 'switchProject');
    await waitFor(() => screen.getByRole('button', { name: /Create new/ }));

    fireEvent.click(screen.getByRole('button', { name: /Create new/ }));

    expect(screen.getByRole('dialog', { name: 'New Project' })).toBeTruthy();
    expect(switchProject).not.toHaveBeenCalled();
  });

  it('creates a new project by name through the New Project dialog and closes it', async () => {
    const api = renderPicker();
    const createProject = vi.spyOn(api, 'createProject');
    await waitFor(() => screen.getByRole('button', { name: /Create new/ }));
    fireEvent.click(screen.getByRole('button', { name: /Create new/ }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fresh Project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith('', 'Fresh Project'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Project' })).toBeNull());
  });

  it('reports a load failure distinctly from an empty recents list', async () => {
    renderPicker({ projectRecents: async () => Promise.reject(new Error('boom')) });

    expect(await screen.findByText("Couldn't load recent projects.")).toBeTruthy();
    expect(screen.queryByText('No recent projects yet.')).toBeNull();
  });

  it('surfaces a rejected switch call as visible text instead of failing silently', async () => {
    const api = renderPicker();
    vi.spyOn(api, 'switchProject').mockRejectedValue(new Error('the desktop host is not ready'));
    await waitFor(() => expect(screen.getByText('Voltage and the Undercroft')).toBeTruthy());

    fireEvent.click(screen.getByText('Voltage and the Undercroft'));

    expect(await screen.findByText('Error: the desktop host is not ready')).toBeTruthy();
  });

  it('removes a recent project when its remove control is clicked', async () => {
    const api = renderPicker();
    const removeRecentProject = vi.spyOn(api, 'removeRecentProject');
    const switchProject = vi.spyOn(api, 'switchProject');
    await waitFor(() => expect(screen.getByText('Voltage and the Undercroft')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Remove Voltage and the Undercroft from recent projects/ }));

    await waitFor(() => expect(removeRecentProject).toHaveBeenCalledWith('C:/Projects/Voltage-and-the-Undercroft'));
    await waitFor(() => expect(screen.queryByText('Voltage and the Undercroft')).toBeNull());
    expect(switchProject).not.toHaveBeenCalled();
  });

  it('surfaces a failed removal as visible text', async () => {
    const api = renderPicker();
    vi.spyOn(api, 'removeRecentProject').mockRejectedValue(new Error('could not update recent projects'));
    await waitFor(() => expect(screen.getByText('Voltage and the Undercroft')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Remove Voltage and the Undercroft from recent projects/ }));

    expect(await screen.findByText('Error: could not update recent projects')).toBeTruthy();
  });

  it('clears a stale error message once a later removal succeeds', async () => {
    const api = renderPicker();
    vi.spyOn(api, 'switchProject').mockRejectedValue(new Error('the desktop host is not ready'));
    await waitFor(() => expect(screen.getByText('Voltage and the Undercroft')).toBeTruthy());
    fireEvent.click(screen.getByText('Voltage and the Undercroft'));
    expect(await screen.findByText('Error: the desktop host is not ready')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice’s Adventures in Wonderland from recent projects' }));

    await waitFor(() => expect(screen.queryByText('Error: the desktop host is not ready')).toBeNull());
  });

  it('moves focus to the next remaining entry after removing a project', async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText('Alice’s Adventures in Wonderland')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice’s Adventures in Wonderland from recent projects' }));

    await waitFor(() => expect(screen.queryByText('Alice’s Adventures in Wonderland')).toBeNull());
    // The row disappears in one commit and focus moves in a later one (once `busy` is false again), so wait for focus itself.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Voltage and the Undercroft from recent projects' })));
  });

  it('moves focus to the recent-projects heading when the last recent project is removed', async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText('Alice’s Adventures in Wonderland')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice’s Adventures in Wonderland from recent projects' }));
    await waitFor(() => expect(screen.queryByText('Alice’s Adventures in Wonderland')).toBeNull());
    // Every control stays disabled until the removal settles (`busy`), and a click on a disabled button is dropped: wait
    // for focus to land on the next remove button, which happens only once it is enabled again.
    const removeVoltage = () => screen.getByRole('button', { name: 'Remove Voltage and the Undercroft from recent projects' });
    await waitFor(() => expect(document.activeElement).toBe(removeVoltage()));

    fireEvent.click(removeVoltage());

    await waitFor(() => expect(screen.queryByText('Voltage and the Undercroft')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Open recent')));
  });

  it('renders the refusal reason when a switch is rejected', async () => {
    renderPicker({
      selectProjectFolder: async () => ({ selected: true, path: 'C:/Projects/New-Project' }),
      switchProject: async () => ({ switched: false, reason: 'Narration Utils is busy, so the current project was left unchanged.' }),
    });
    await waitFor(() => screen.getByRole('button', { name: /Browse/ }));

    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));

    expect(await screen.findByText('Narration Utils is busy, so the current project was left unchanged.')).toBeTruthy();
  });
});
