// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReaderCard } from './ReaderCard';

afterEach(cleanup);

function renderCard(overrides: Partial<Parameters<typeof ReaderCard>[0]> = {}) {
  const onToggleExpand = vi.fn();
  const onToggleBookmark = vi.fn();
  const onReadAloud = vi.fn();
  render(
    <ReaderCard
      chapterId="c1"
      title="Chapter 2"
      subtitle="The Pool of Tears"
      expanded={false}
      onToggleExpand={onToggleExpand}
      bookmarked={false}
      onToggleBookmark={onToggleBookmark}
      showReadAloud
      onReadAloud={onReadAloud}
      wordCount={3182}
      {...overrides}
    >
      <p>Body</p>
    </ReaderCard>,
  );
  return { onToggleExpand, onToggleBookmark, onReadAloud };
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

  it('pressing Read aloud reads aloud, not the card', async () => {
    const user = userEvent.setup();
    const { onReadAloud, onToggleExpand } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Read Chapter 2 aloud' }));
    expect(onReadAloud).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it('shows the stat block before the action slot, and the chevron last, in DOM order (manuscript-chapter-header-alignment.prd.md)', () => {
    renderCard();
    const header = document.querySelector('header')!;
    const wordsIndex = header.innerHTML.indexOf('3,182 words');
    const actionIndex = header.innerHTML.indexOf('Read Chapter 2 aloud');
    const chevronIndex = header.innerHTML.indexOf('data-icon="chevron-down"');
    expect(wordsIndex).toBeGreaterThan(-1);
    expect(actionIndex).toBeGreaterThan(wordsIndex);
    expect(chevronIndex).toBeGreaterThan(actionIndex);
  });

  it('renders an empty, same-width action slot when there is no Read aloud (a row with no action still lines up)', () => {
    renderCard({ showReadAloud: false, onReadAloud: undefined });
    expect(screen.queryByRole('button', { name: /Read .* aloud/ })).toBeNull();
    const slots = document.querySelectorAll('.w-32');
    expect(slots.length).toBe(1);
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
    renderCard({ wordCount: 7, showReadAloud: false, onReadAloud: undefined });
    expect(screen.getByText('~2 s read')).toBeTruthy();
  });
});
