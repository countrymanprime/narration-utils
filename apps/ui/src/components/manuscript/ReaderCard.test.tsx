// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReaderCard } from './ReaderCard';

afterEach(cleanup);

function renderCard(overrides: Partial<Parameters<typeof ReaderCard>[0]> = {}) {
  const onToggleExpand = vi.fn();
  const onToggleBookmark = vi.fn();
  const onRecordInBooth = vi.fn();
  render(
    <ReaderCard
      chapterId="c1"
      title="Chapter 2"
      subtitle="The Pool of Tears"
      expanded={false}
      onToggleExpand={onToggleExpand}
      bookmarked={false}
      onToggleBookmark={onToggleBookmark}
      onRecordInBooth={onRecordInBooth}
      wordCount={3182}
      {...overrides}
    >
      <p>Body</p>
    </ReaderCard>,
  );
  return { onToggleExpand, onToggleBookmark, onRecordInBooth };
}

describe('ReaderCard (manuscript-credits-card-parity.prd.md, manuscript-chapter-header-alignment.prd.md)', () => {
  it('reports aria-expanded and aria-controls naming the body, on the toggle whose accessible name is the title', () => {
    renderCard({ expanded: true });
    const toggle = screen.getByRole('button', { name: 'Chapter 2 — The Pool of Tears' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const bodyId = toggle.getAttribute('aria-controls');
    expect(bodyId).toBeTruthy();
    expect(document.getElementById(bodyId!)?.textContent).toBe('Body');
  });

  it('toggles when the title button is pressed', async () => {
    const user = userEvent.setup();
    const { onToggleExpand } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Chapter 2 — The Pool of Tears' }));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it(
    "stretches the toggle's own hit area over the whole header with a CSS overlay, not a JS handler on the header " +
      '(jsdom cannot hit-test the overlay; the Playwright driver for manuscript/chapter-header-columns presses the ' +
      'stat block for real and checks it toggled)',
    () => {
      renderCard();
      const toggle = screen.getByRole('button', { name: 'Chapter 2 — The Pool of Tears' });
      expect(toggle.className).toContain('after:absolute');
      expect(toggle.className).toContain('after:inset-0');
    },
  );

  it('Enter and Space on the focused toggle activate it, like any native button', async () => {
    const user = userEvent.setup();
    const { onToggleExpand } = renderCard();
    await user.tab(); // bookmark
    await user.tab(); // the toggle
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Chapter 2 — The Pool of Tears' }));
    await user.keyboard('{Enter}');
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onToggleExpand).toHaveBeenCalledTimes(2);
  });

  it('pressing the bookmark toggles the bookmark, not the card', async () => {
    const user = userEvent.setup();
    const { onToggleBookmark, onToggleExpand } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Bookmark this chapter' }));
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it('pressing Record in Booth opens the Booth, not the card (stage-navigation-and-page-replacement.prd.md Q9)', async () => {
    const user = userEvent.setup();
    const { onRecordInBooth, onToggleExpand } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Record Chapter 2 in Booth' }));
    expect(onRecordInBooth).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it('shows the stat block before the action slot, and the chevron last, in DOM order (manuscript-chapter-header-alignment.prd.md)', () => {
    renderCard();
    const header = document.querySelector('header')!;
    const wordsIndex = header.innerHTML.indexOf('3,182 words');
    const actionIndex = header.innerHTML.indexOf('Record Chapter 2 in Booth');
    const chevronIndex = header.innerHTML.indexOf('data-icon="chevron-down"');
    expect(wordsIndex).toBeGreaterThan(-1);
    expect(actionIndex).toBeGreaterThan(wordsIndex);
    expect(chevronIndex).toBeGreaterThan(actionIndex);
  });

  it('renders an empty, same-width action slot when there is nothing to record (a row with no action still lines up)', () => {
    renderCard({ onRecordInBooth: undefined });
    expect(screen.queryByRole('button', { name: /in Booth/ })).toBeNull();
    const slots = document.querySelectorAll('.w-52');
    expect(slots.length).toBe(1);
  });

  it('offers one Booth action, not the old Read aloud, Booth and Companion buttons (ADR 0407)', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: /aloud/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open (booth|companion) for/ })).toBeNull();
  });

  // edit-and-proof-workspace.prd.md Phase 4: the chapter header's "Open workspace" entry, icon-only.
  it('pressing Workspace opens the workspace, not the card', async () => {
    const user = userEvent.setup();
    const onWorkspace = vi.fn();
    const onToggleExpand = vi.fn();
    render(
      <ReaderCard chapterId="c1" title="Chapter 2" expanded={false} onToggleExpand={onToggleExpand} showWorkspace onWorkspace={onWorkspace} wordCount={3182}>
        <p>Body</p>
      </ReaderCard>,
    );
    await user.click(screen.getByRole('button', { name: 'Open workspace for Chapter 2' }));
    expect(onWorkspace).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it('renders no Workspace button when showWorkspace is false', () => {
    renderCard({ showWorkspace: false, onWorkspace: undefined });
    expect(screen.queryByRole('button', { name: /Open workspace for/ })).toBeNull();
  });

  it('shows a chevron that flips with expanded state', () => {
    const { container: collapsed } = render(
      <ReaderCard chapterId="c1" title="Chapter 2" expanded={false} onToggleExpand={vi.fn()} wordCount={100}>
        <p />
      </ReaderCard>,
    );
    expect(collapsed.querySelector('[data-icon="chevron-down"]')).toBeTruthy();
    cleanup();
    const { container: expanded } = render(
      <ReaderCard chapterId="c1" title="Chapter 2" expanded onToggleExpand={vi.fn()} wordCount={100}>
        <p />
      </ReaderCard>,
    );
    expect(expanded.querySelector('[data-icon="chevron-up"]')).toBeTruthy();
  });

  it('renders no bookmark button when onToggleBookmark is omitted (MC1: credits have no bookmark)', () => {
    renderCard({ onToggleBookmark: undefined, bookmarked: undefined });
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();
  });

  it('still reserves the leading grid cell with no bookmark, so the toggle and the stat cluster keep their own grid columns', () => {
    // A React child that is entirely absent (not merely empty) is not a grid item, so CSS grid auto-placement shifts
    // every following item left by one column and the last (stat/action/chevron) column collapses to 0 width - the
    // real bug this pins: credits (no bookmark) rendered its stat block flush against the title instead of at the
    // header's right edge, in a real browser, even though every relevant jsdom test still passed.
    renderCard({ onToggleBookmark: undefined, bookmarked: undefined });
    const header = document.querySelector('header')!;
    expect(header.children).toHaveLength(3);
  });

  it('carries a chapter id as data-chapter/data-chapter-id, or a credits kind as data-credits-entry, not both', () => {
    const { container: chapter } = render(
      <ReaderCard chapterId="c1" title="Chapter 2" expanded={false} onToggleExpand={vi.fn()} wordCount={100}>
        <p />
      </ReaderCard>,
    );
    const article = chapter.querySelector('article')!;
    expect(article.getAttribute('data-chapter')).toBe('Chapter 2');
    expect(article.getAttribute('data-chapter-id')).toBe('c1');
    expect(article.hasAttribute('data-credits-entry')).toBe(false);
    cleanup();
    const { container: credits } = render(
      <ReaderCard creditsKind="opening" eyebrow="Credits" title="Opening credits" expanded={false} onToggleExpand={vi.fn()} wordCount={7}>
        <p />
      </ReaderCard>,
    );
    const creditsArticle = credits.querySelector('article')!;
    expect(creditsArticle.getAttribute('data-credits-entry')).toBe('opening');
    expect(creditsArticle.hasAttribute('data-chapter')).toBe(false);
  });

  it("shows the eyebrow but keeps it out of the toggle's accessible name", () => {
    render(
      <ReaderCard creditsKind="opening" eyebrow="Credits" title="Opening credits" expanded={false} onToggleExpand={vi.fn()} wordCount={7}>
        <p />
      </ReaderCard>,
    );
    expect(screen.getByText('Credits').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Opening credits' })).toBeTruthy();
  });

  it('shows the read time from the shared helper, seconds under a minute', () => {
    renderCard({ wordCount: 7, onRecordInBooth: undefined });
    expect(screen.getByText('~2 s read')).toBeTruthy();
  });

  // D85 #3 on issue #509, ADR 0393 (superseding ADR 0392): the header's cluster-wrap decision keys off the card's own
  // rendered width (a CSS container query), not the viewport (`md`), so it stays correct once a narrower card can exist
  // at a wide viewport (the Script page's mock-02 three columns). jsdom does not evaluate container queries - a real
  // browser check is Playwright's `chapter-header-columns` driver (script.ts) plus the retail-sample and markup-dialog
  // visual states at desktop (1440px) - so this test only pins the mechanism: the card is a query container, and the
  // cluster's own wrap classes are container-query variants (`@min-`/`@max-`), not the old viewport ones (`md`/`max-md`).
  it('makes the card a CSS container, and switches the header cluster on its own width, not the viewport', () => {
    renderCard();
    const article = document.querySelector('article')!;
    expect(article.className).toContain('@container');
    const header = document.querySelector('header')!;
    expect(header.className).toMatch(/@min-\[[^\]]+\]:grid-cols-/);
    expect(header.className).not.toMatch(/(^|\s)md:grid-cols-/);
    const cluster = header.querySelector(':scope > div:last-child')!;
    expect(cluster.className).toMatch(/@max-\[[^\]]+\]:col-start-2/);
    expect(cluster.className).not.toMatch(/(^|\s)max-md:col-start-2/);
  });
});
