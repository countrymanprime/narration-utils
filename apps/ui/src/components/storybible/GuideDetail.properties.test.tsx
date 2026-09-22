// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_ENTITIES } from '../../api/mockFixtures';
import type { GuideEntity } from '../../types';
import { GuideDetail } from './GuideDetail';
import { EntitySummary } from '../manuscript/EntitySummary';

afterEach(() => cleanup());

const fixture = (pick: (row: GuideEntity) => boolean): GuideEntity => {
  const row = WIRE_ENTITIES.find(pick);
  if (!row) throw new Error('the fixture entry is missing');
  return row;
};
const alice = fixture((row) => row.id === 'alice');
const queen = fixture((row) => row.locked);
const caterpillar = fixture((row) => row.id === 'caterpillar');

function renderDetail(entity = alice) {
  const api = createMockApi();
  const guideEdit = vi.spyOn(api, 'guideEdit');
  render(
    <ApiProvider api={api}>
      <GuideDetail entity={entity} entities={WIRE_ENTITIES} reload={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} goToManuscript={vi.fn()} />
    </ApiProvider>,
  );
  return { guideEdit };
}

const properties = () => screen.getByRole('table', { name: 'Properties' });
const startEditing = () => fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes to this entry' }));
const savedProperties = (guideEdit: { mock: { calls: Array<[string, Record<string, string>]> } }, call = 0): unknown =>
  JSON.parse(guideEdit.mock.calls[call][1].properties);

describe('Story Bible entry properties', () => {
  it('lists the properties in order as text in the read view, with no field to type in', () => {
    renderDetail();
    const cells = within(properties())
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells).toEqual(expect.arrayContaining(['Age', 'Seven', 'Home', 'Oxford']));
    expect(within(properties()).queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add property' })).toBeNull();
  });

  it('says there are none when an entry has none', () => {
    renderDetail(caterpillar);
    expect(within(properties()).getByText('No properties yet.')).toBeTruthy();
  });

  it("shows a locked entry's properties but offers nothing to change them", () => {
    renderDetail(queen);
    expect(within(properties()).getByText('Queen of Hearts')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add property' })).toBeNull();
    expect(within(properties()).queryByRole('textbox')).toBeNull();
  });

  it('turns the rows into fields in edit mode and saves an added, renamed and edited property as one ordered list', async () => {
    const { guideEdit } = renderDetail();
    startEditing();
    fireEvent.change(screen.getByRole('textbox', { name: 'Property 1 value' }), { target: { value: 'Eight' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Property 3 name' }), { target: { value: 'Codename' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Property 3 value' }), { target: { value: 'Wren' } });
    save();
    await waitFor(() => expect(guideEdit).toHaveBeenCalledTimes(1));
    expect(guideEdit.mock.calls[0][0]).toBe('alice');
    expect(savedProperties(guideEdit)).toEqual([
      { key: 'Age', value: 'Eight' },
      { key: 'Home', value: 'Oxford' },
      { key: 'Codename', value: 'Wren' },
    ]);
  });

  it('moves a property up or down and removes one', async () => {
    const { guideEdit } = renderDetail();
    startEditing();
    fireEvent.click(screen.getByRole('button', { name: 'Move property Age down' }));
    expect(screen.getByRole('textbox', { name: 'Property 1 name' })).toHaveProperty('value', 'Home');
    expect(screen.getByRole('button', { name: 'Move property Home up' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove property Home' }));
    save();
    await waitFor(() => expect(guideEdit).toHaveBeenCalledTimes(1));
    expect(savedProperties(guideEdit)).toEqual([{ key: 'Age', value: 'Seven' }]);
  });

  it('does not send the properties when they were not changed', async () => {
    const { guideEdit } = renderDetail();
    startEditing();
    fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: 'Alice Liddell' } });
    save();
    await waitFor(() => expect(guideEdit).toHaveBeenCalledTimes(1));
    expect(guideEdit.mock.calls[0][1]).not.toHaveProperty('properties');
  });

  it('drops a row left blank and does not count it as a change', async () => {
    const { guideEdit } = renderDetail();
    startEditing();
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: 'Alice Liddell' } });
    save();
    await waitFor(() => expect(guideEdit).toHaveBeenCalledTimes(1));
    expect(guideEdit.mock.calls[0][1]).not.toHaveProperty('properties');
  });

  it('refuses a value with no name, says which property, and sends nothing', async () => {
    const { guideEdit } = renderDetail();
    startEditing();
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Property 3 value' }), { target: { value: 'Wren' } });
    save();
    expect((await screen.findByRole('alert')).textContent).toBe('Give property 3 a name, or clear its value.');
    expect(guideEdit).not.toHaveBeenCalled();
    // Typing in a property clears the message.
    fireEvent.change(screen.getByRole('textbox', { name: 'Property 3 name' }), { target: { value: 'Codename' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses two properties with one name', async () => {
    const { guideEdit } = renderDetail();
    startEditing();
    fireEvent.change(screen.getByRole('textbox', { name: 'Property 2 name' }), { target: { value: 'age' } });
    save();
    expect((await screen.findByRole('alert')).textContent).toBe('Two properties are named “age”. Give each a different name.');
    expect(guideEdit).not.toHaveBeenCalled();
  });

  it('puts the saved rows back when editing is cancelled', () => {
    renderDetail();
    startEditing();
    fireEvent.click(screen.getByRole('button', { name: 'Remove property Age' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(within(properties()).getByText('Age')).toBeTruthy();
  });
});

describe('the entry summary opened from the Manuscript', () => {
  it('lists the properties, and leaves the section out when there are none', () => {
    const { unmount } = render(<EntitySummary entity={alice} jumpToLine={vi.fn()} />);
    expect(screen.getByText('Properties')).toBeTruthy();
    expect(screen.getByText('Seven')).toBeTruthy();
    unmount();
    render(<EntitySummary entity={caterpillar} jumpToLine={vi.fn()} />);
    expect(screen.queryByText('Properties')).toBeNull();
  });
});
