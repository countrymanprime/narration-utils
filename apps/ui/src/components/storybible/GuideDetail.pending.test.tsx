// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_ENTITIES } from '../../api/mockFixtures';
import type { NarrationApi } from '../../types';
import { GuideDetail } from './GuideDetail';

// ADR 0075: every Story Bible action acknowledges within 100 ms and cannot be fired twice. Each case starts the action against a host call
// that never answers (a Python process that has not finished), presses it twice, and looks at what the narrator would see.

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const neverAnswers = <T,>() => vi.fn(() => new Promise<T>(() => {}));

const entity = WIRE_ENTITIES.find((row) => !row.locked && row.relationships.length > 0 && row.id === 'alice') ?? WIRE_ENTITIES[0];

function renderDetail(overrides: Partial<NarrationApi>) {
  const api = createMockApi(overrides);
  render(
    <ApiProvider api={api}>
      <GuideDetail entity={entity} entities={WIRE_ENTITIES} reload={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} goToManuscript={vi.fn()} />
    </ApiProvider>,
  );
  return api;
}

const press = (name: string | RegExp, times = 2) => {
  for (let i = 0; i < times; i++) fireEvent.click(screen.getAllByRole('button', { name })[0]);
};
const acknowledged = () => act(() => void vi.advanceTimersByTime(100));
const busy = (name: string | RegExp) => screen.getAllByRole('button', { name })[0].getAttribute('aria-busy') === 'true';
const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));

describe('Story Bible actions acknowledge within 100 ms and cannot be fired twice', () => {
  it('Save', () => {
    const guideEdit = neverAnswers<void>();
    renderDetail({ guideEdit });
    edit();
    press('Save changes to this entry');
    acknowledged();
    expect(guideEdit).toHaveBeenCalledTimes(1);
    expect(busy('Save changes to this entry')).toBe(true);
  });

  it('Lock', () => {
    const guideSetLocked = neverAnswers<void>();
    renderDetail({ guideSetLocked });
    press('Lock entry');
    acknowledged();
    expect(guideSetLocked).toHaveBeenCalledTimes(1);
    expect(busy(/lock entry/i)).toBe(true);
  });

  it('Rescan occurrences', () => {
    const guideRescan = neverAnswers<void>();
    renderDetail({ guideRescan });
    press('Rescan occurrences');
    acknowledged();
    expect(guideRescan).toHaveBeenCalledTimes(1);
    expect(busy('Rescan occurrences')).toBe(true);
  });

  it('Add alias', () => {
    const guideEdit = neverAnswers<void>();
    renderDetail({ guideEdit });
    edit();
    fireEvent.change(screen.getByRole('combobox', { name: 'Add an alias or find a matching entry' }), { target: { value: 'Ali' } });
    press('Add alias');
    acknowledged();
    expect(guideEdit).toHaveBeenCalledTimes(1);
    expect(busy('Add alias')).toBe(true);
  });

  it('keeps an alias the narrator typed while another action was running, instead of clearing it and adding nothing', () => {
    const guideEdit = neverAnswers<void>();
    renderDetail({ guideEdit, guideSetLocked: neverAnswers<void>() });
    edit();
    press('Lock entry', 1);
    const box = screen.getByRole('combobox', { name: 'Add an alias or find a matching entry' });
    fireEvent.change(box, { target: { value: 'Ali' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    acknowledged();
    expect(guideEdit).not.toHaveBeenCalled();
    expect((box as HTMLInputElement).value).toBe('Ali');
  });

  it('Remove relationship, and the other buttons wait while it runs', () => {
    const guideRelate = neverAnswers<void>();
    const guideUnrelate = neverAnswers<void>();
    renderDetail({ guideRelate, guideUnrelate });
    edit();
    press('Remove relationship');
    acknowledged();
    expect(guideUnrelate).toHaveBeenCalledTimes(1);
    // Another action waits while one runs: this is not a second press of the same button, it is a different button.
    press('Add alias', 1);
    expect(guideRelate).not.toHaveBeenCalled();
  });

  it('Delete: the confirm says it is working, ignores a second press, and cannot be cancelled away', () => {
    const guideDelete = neverAnswers<void>();
    renderDetail({ guideDelete });
    fireEvent.click(screen.getByRole('button', { name: 'Delete entity' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete entry' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete entry' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete entry' }));
    acknowledged();
    expect(guideDelete).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: 'Delete entry' }).getAttribute('aria-busy')).toBe('true');
    expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('an uncached preview: the button says it is rendering and a second press does not start a second render', () => {
    const guidePreview = neverAnswers<never>();
    renderDetail({ guidePreview });
    press('Play preview');
    acknowledged();
    expect(guidePreview).toHaveBeenCalledTimes(1);
    expect(busy(/preview/i)).toBe(true);
  });

  it('while one action runs the other mutating controls are off, so two actions never overlap on the same file', () => {
    renderDetail({ guideSetLocked: neverAnswers<void>() });
    press('Lock entry', 1);
    acknowledged();
    expect((screen.getByRole('button', { name: 'Delete entity' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Rescan occurrences' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
