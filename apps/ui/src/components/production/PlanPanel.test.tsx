// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { PRODUCTION_SCENARIOS } from '../../api/productionMock';
import { ACX_CHECKPOINT, PlanPanel } from './PlanPanel';

afterEach(cleanup);

function renderPanel(initial: Parameters<typeof createMockApi>[1] = {}) {
  const api = createMockApi({}, initial);
  const onSaved = vi.fn();
  render(
    <ApiProvider api={api}>
      <PlanPanel onSaved={onSaved} />
    </ApiProvider>,
  );
  return { api, onSaved };
}

describe('PlanPanel', () => {
  it('shows the plan already set', async () => {
    renderPanel({ production: PRODUCTION_SCENARIOS['on-pace'] });
    expect(((await screen.findByLabelText('Delivery date')) as HTMLInputElement).value).toBe('2026-10-14');
    expect((screen.getByLabelText('Contracted amount') as HTMLInputElement).value).toBe('2400');
  });

  it('saves a delivery date and amount, and tells the page to read its figures again', async () => {
    const { api, onSaved } = renderPanel();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Delivery date'), '2026-12-01');
    await user.type(screen.getByLabelText('Contracted amount'), '1800');
    await user.click(screen.getByRole('button', { name: 'Save date and amount' }));
    expect((await screen.findByRole('status')).textContent).toContain('Saved');
    expect(await api.productionPlan()).toMatchObject({ deadline: '2026-12-01', contractedAmount: 1800 });
    expect(onSaved).toHaveBeenCalled();
  });

  it('refuses an amount that is not a number without saving, and shows the host refusing an impossible date', async () => {
    const { api } = renderPanel();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Contracted amount'), 'lots');
    await user.click(screen.getByRole('button', { name: 'Save date and amount' }));
    expect(screen.getByText(/Write the amount as a number/)).toBeTruthy();
    expect((await api.productionPlan()).contractedAmount).toBeNull();
    await user.clear(screen.getByLabelText('Contracted amount'));
    await user.type(screen.getByLabelText('Delivery date'), '2026-02-30');
    await user.click(screen.getByRole('button', { name: 'Save date and amount' }));
    expect((await screen.findByRole('alert')).textContent).toContain('2026-02-30');
    expect((await api.productionPlan()).deadline).toBeNull();
  });

  it('adds the ACX 15-minute checkpoint as an ordinary milestone and saves the list', async () => {
    const { api } = renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add the ACX 15-minute checkpoint' }));
    const list = screen.getByRole('list', { name: 'Milestones' });
    const row = within(list).getAllByRole('listitem')[0];
    expect((within(row).getByLabelText('Name') as HTMLInputElement).value).toBe(ACX_CHECKPOINT.name);
    // The template is offered once.
    expect(screen.getByRole('button', { name: 'Add the ACX 15-minute checkpoint' }).hasAttribute('disabled')).toBe(true);
    await user.type(within(row).getByLabelText('Due date'), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Save milestones' }));
    expect((await screen.findByRole('status')).textContent).toContain('Saved');
    expect((await api.productionPlan()).milestones).toEqual([{ name: ACX_CHECKPOINT.name, dueDate: '2026-10-01', note: ACX_CHECKPOINT.note }]);
    await user.click(within(screen.getByRole('list', { name: 'Milestones' })).getByRole('button', { name: `Remove ${ACX_CHECKPOINT.name}` }));
    await user.click(screen.getByRole('button', { name: 'Save milestones' }));
    await vi.waitFor(async () => expect((await api.productionPlan()).milestones).toEqual([]));
  });

  it("shows the host's refusal of a milestone with no name and saves nothing", async () => {
    const { api } = renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add milestone' }));
    await user.type(screen.getByLabelText('Due date'), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Save milestones' }));
    expect((await screen.findByRole('alert')).textContent).toContain('needs a name');
    expect((await api.productionPlan()).milestones).toEqual([]);
  });
});
