// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { ProductionChapter, ProductionOverview } from '../../api/contracts/production';
import type { NarrationApi } from '../../types';
import { CompanionThisChapter } from './CompanionThisChapter';

afterEach(cleanup);

async function renderWith(chapter: Partial<ProductionChapter> | undefined, chapterId = 'c1') {
  const base = createMockApi();
  const overview = await base.productionOverview();
  const row = chapter && ({ ...overview.chapters[0], id: 'c1', ...chapter } as ProductionChapter);
  const api: NarrationApi = { ...base, productionOverview: async (): Promise<ProductionOverview> => ({ ...overview, chapters: row ? [row] : [] }) };
  render(
    <ApiProvider api={api}>
      <CompanionThisChapter chapterId={chapterId} />
    </ApiProvider>,
  );
}

describe('CompanionThisChapter (mock 07: "Recorded 12:40 · ..." and the QC line)', () => {
  it("shows the chapter's measured recorded length and its stage with the reason that holds it back", async () => {
    await renderWith({ recordedSeconds: 760, status: 'editing', readiness: { verdict: 'not_ready', reason: 'Head room tone is 0.3 s' } });
    expect(await screen.findByText(/Recorded 12:40/)).toBeTruthy();
    expect(screen.getByText(/Editing/)).toBeTruthy();
    expect(screen.getByText(/Head room tone is 0\.3 s/)).toBeTruthy();
  });

  it('says so when the length was not measured', async () => {
    await renderWith({ recordedSeconds: null, status: 'not_started', readiness: null });
    expect(await screen.findByText('Recorded length not measured')).toBeTruthy();
  });

  it('draws nothing but an honest empty line for a chapter the board does not list', async () => {
    await renderWith(undefined);
    expect(await screen.findByText('Nothing measured for this chapter yet.')).toBeTruthy();
  });
});
