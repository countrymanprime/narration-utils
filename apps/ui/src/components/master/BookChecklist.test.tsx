// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { MOCK_ACX } from '../../api/deliveryProfilesMock';
import { createMockApi } from '../../api/mockApi';
import { measureJobSchema } from '../../api/schemas/measure';
import type { DeliveryRuleResult, MeasureJob } from '../../types';
import { BookChecklist } from './BookChecklist';

afterEach(cleanup);

const contract = (name: string): MeasureJob =>
  measureJobSchema.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', name), 'utf8')));

function renderList(bookRules: readonly DeliveryRuleResult[]) {
  render(
    <ApiProvider api={createMockApi()}>
      <BookChecklist profile={MOCK_ACX} bookRules={bookRules} />
    </ApiProvider>,
  );
  return screen.getByRole('list', { name: 'Book checklist' });
}

const itemFor = (list: HTMLElement, name: string) => {
  const item = within(list)
    .getAllByRole('listitem')
    .find((candidate) => candidate.textContent?.startsWith(name));
  if (!item) throw new Error(`no item for ${name}`);
  return item;
};

describe('Book checklist (delivery-platform-profiles.prd.md Phase 7, mock 05’s delivery package)', () => {
  it('lists every book-scope rule of the profile, judged against the host answer, its result said in words', () => {
    const list = renderList(contract('measure-success.json').bookRules);
    expect(itemFor(list, 'Channels').textContent).toContain(': Not met');
    expect(itemFor(list, 'Channels').textContent).toContain('The measured files do not all agree.');
    expect(itemFor(list, 'One section per file').textContent).toContain(': Listen');
    expect(itemFor(list, 'One section per file').textContent).toContain('Listen: each file holds one chapter');
  });

  it('shows credits and retail-sample facts from the project as a bonus line, never as a pass', async () => {
    const list = renderList(contract('measure-success.json').bookRules);
    await waitFor(() => expect(itemFor(list, 'Credits files').textContent).toMatch(/credits template/));
    expect(itemFor(list, 'Credits files').textContent).toContain(': Not checked by the app');
    await waitFor(() => expect(itemFor(list, 'Retail sample').textContent).toMatch(/retail sample/i));
  });
});
