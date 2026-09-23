// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi } from '../../types';
import { DawCatalogPanel } from './DawCatalogPanel';

afterEach(cleanup);

function renderPanel(
  overrides: Partial<NarrationApi> = {},
  initial: Parameters<typeof createMockApi>[1] = {},
  props: { dawFileLinked?: boolean; onLinkDawFile?: () => void } = {},
) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <DawCatalogPanel notify={vi.fn()} {...props} />
    </ApiProvider>,
  );
  return api;
}

describe('DawCatalogPanel', () => {
  it('shows REAPER detected and offers Check again, with no Get REAPER button', async () => {
    renderPanel();
    expect(await screen.findByText('REAPER detected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Get REAPER' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('offers Get REAPER when it is not detected, and Check again is still offered', async () => {
    renderPanel({}, { dawCatalogInstalled: false });
    expect(await screen.findByText('REAPER not detected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get REAPER' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  // docs/architecture/daw-integration.md: a manual re-check, since detection only otherwise
  // runs when the panel mounts and a narrator who just installed REAPER should not have to leave and reopen Settings.
  it('re-runs detection on Check again', async () => {
    const dawCatalogList = vi.fn(createMockApi().dawCatalogList);
    renderPanel({ dawCatalogList });
    await screen.findByText('REAPER detected');
    expect(dawCatalogList).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(dawCatalogList).toHaveBeenCalledTimes(2));
  });

  it('disables Check again and shows Checking… while it runs', async () => {
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    let calls = 0;
    const dawCatalogList = async () => {
      calls += 1;
      if (calls > 1) await pending;
      return createMockApi().dawCatalogList();
    };
    renderPanel({ dawCatalogList });
    await screen.findByText('REAPER detected');

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    const checking = (await screen.findByRole('button', { name: 'Checking…' })) as HTMLButtonElement;
    expect(checking.disabled).toBe(true);
    finish();
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  // Phase 3's "Could" item: a handoff into the DAW Link flow once a DAW is detected.
  it('offers to link a REAPER project once detected and not yet linked', async () => {
    const onLinkDawFile = vi.fn();
    renderPanel({}, {}, { dawFileLinked: false, onLinkDawFile });
    await screen.findByText('REAPER detected');

    const linkButton = screen.getByRole('button', { name: 'Link a REAPER project file' });
    fireEvent.click(linkButton);
    expect(onLinkDawFile).toHaveBeenCalledTimes(1);
  });

  it('does not offer the handoff link once a REAPER project is already linked', async () => {
    renderPanel({}, {}, { dawFileLinked: true, onLinkDawFile: vi.fn() });
    await screen.findByText('REAPER detected');
    expect(screen.queryByRole('button', { name: 'Link a REAPER project file' })).toBeNull();
  });

  it('does not offer the handoff link when nothing is detected', async () => {
    renderPanel({}, { dawCatalogInstalled: false }, { dawFileLinked: false, onLinkDawFile: vi.fn() });
    await screen.findByText('REAPER not detected');
    expect(screen.queryByRole('button', { name: 'Link a REAPER project file' })).toBeNull();
  });

  it('does not offer the handoff link when no onLinkDawFile is given', async () => {
    renderPanel({}, {}, { dawFileLinked: false });
    await screen.findByText('REAPER detected');
    expect(screen.queryByRole('button', { name: 'Link a REAPER project file' })).toBeNull();
  });

  it('shows an error inline when the catalog cannot be loaded, with no Check again shown for a state that never loaded', async () => {
    renderPanel({
      dawCatalogList: async () => {
        throw new Error('the host did not answer');
      },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('the host did not answer');
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });
});
