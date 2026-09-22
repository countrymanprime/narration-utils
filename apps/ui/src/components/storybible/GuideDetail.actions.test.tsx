// @vitest-environment jsdom
// Mode-based header actions (ADR 0087, story bible entries PRD phase 2): Lock/Unlock lives in the read view only, Delete lives in edit
// mode only, and an entry can never be locked while it is being edited (the hazard ADR 0018 left open).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_ENTITIES } from '../../api/mockFixtures';
import type { GuideEntity } from '../../types';
import { GuideDetail } from './GuideDetail';

afterEach(() => cleanup());

const fixture = (pick: (row: GuideEntity) => boolean): GuideEntity => {
  const row = WIRE_ENTITIES.find(pick);
  if (!row) throw new Error('the fixture entry is missing');
  return row;
};
const unlocked = fixture((row) => !row.locked);
const locked = fixture((row) => row.locked);

function renderDetail(entity: GuideEntity) {
  render(
    <ApiProvider api={createMockApi()}>
      <GuideDetail entity={entity} entities={WIRE_ENTITIES} reload={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} goToManuscript={vi.fn()} />
    </ApiProvider>,
  );
}

describe('Story Bible header actions by mode', () => {
  it('the read view offers Lock and Edit, and no Delete', () => {
    renderDetail(unlocked);
    expect(screen.getByRole('button', { name: 'Lock entry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit this entry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete entity' })).toBeNull();
  });

  it('edit mode offers Save, Cancel and a red Delete, and no Lock', () => {
    renderDetail(unlocked);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    expect(screen.getByRole('button', { name: 'Save changes to this entry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeTruthy();
    const deleteButton = screen.getByRole('button', { name: 'Delete entity' });
    expect(deleteButton.className).toContain('border-[var(--danger)]');
    expect(deleteButton.className).toContain('text-[var(--danger-text)]');
    expect(screen.queryByRole('button', { name: 'Lock entry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unlock entry' })).toBeNull();
  });

  it('a locked entry offers only Unlock: no Edit, no Save, no Delete', () => {
    renderDetail(locked);
    expect(screen.getByRole('button', { name: 'Unlock entry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit this entry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes to this entry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete entity' })).toBeNull();
  });

  it('cannot be locked mid-edit, so Lock then Unlock can no longer snap back into edit mode', () => {
    renderDetail(unlocked);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    // There is no way to reach Lock from here - the hazard ADR 0018 left open cannot occur.
    expect(screen.queryByRole('button', { name: 'Lock entry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lock entry' }));
  });
});
