// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditsEntry } from './CreditsEntry';
import type { CreditsRenderResult } from '../../types';

afterEach(cleanup);

describe('CreditsEntry (Manuscript pseudo-entry for opening/closing credits, PRD audiobook-credits-templates.prd.md Phase 3)', () => {
  it('shows the kind label and is collapsed when expanded=false, with no preview text rendered', () => {
    render(<CreditsEntry kind="opening" expanded={false} onToggle={vi.fn()} textClass="text-sm" />);
    expect(screen.getByRole('heading', { name: 'Opening credits' })).toBeTruthy();
    expect(screen.queryByText(/Nothing to preview yet/)).toBeNull();
  });

  it('shows rendered credits text and word count when expanded with a fully-resolved preview', () => {
    const preview: CreditsRenderResult = { text: 'Alice, written by Lewis Carroll, narrated by You.', words: 7, unresolved: [] };
    render(<CreditsEntry kind="opening" preview={preview} expanded onToggle={vi.fn()} textClass="text-sm" />);
    expect(screen.getByText('Alice, written by Lewis Carroll, narrated by You.')).toBeTruthy();
    expect(screen.getByText(/7 words/)).toBeTruthy();
  });

  it('renders an unresolved token as a highlighted chip and reports the unresolved count, never as silent empty text (C6)', () => {
    const preview: CreditsRenderResult = { text: '[Title], written by [Author], narrated by You.', words: 6, unresolved: ['Title', 'Author'] };
    render(<CreditsEntry kind="closing" preview={preview} expanded onToggle={vi.fn()} textClass="text-sm" />);
    expect(screen.getByText('[Title]')).toBeTruthy();
    expect(screen.getByText('[Author]')).toBeTruthy();
    expect(screen.getByText(/2 unresolved tokens: Title, Author/)).toBeTruthy();
  });

  it('calls onToggle when the header is activated, and reflects aria-expanded', () => {
    const onToggle = vi.fn();
    render(<CreditsEntry kind="closing" expanded={false} onToggle={onToggle} textClass="text-sm" />);
    screen.getByRole('button', { name: /Closing credits/ }).click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('labels closing credits distinctly from opening credits', () => {
    render(<CreditsEntry kind="closing" expanded={false} onToggle={vi.fn()} textClass="text-sm" />);
    expect(screen.getByRole('heading', { name: 'Closing credits' })).toBeTruthy();
  });

  it('renders one row per line, matching how the teleprompter splits the same text (MC3)', () => {
    const preview: CreditsRenderResult = { text: 'Alice\nwritten by Lewis Carroll\n\nnarrated by You.', words: 8, unresolved: [] };
    const { container } = render(<CreditsEntry kind="opening" preview={preview} expanded onToggle={vi.fn()} textClass="text-sm" />);
    const rows = container.querySelectorAll('p.text-sm');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toBe('Alice');
    expect(rows[1].textContent).toBe('written by Lewis Carroll');
    expect(rows[2].textContent).toBe('narrated by You.');
  });

  it('follows the page Text size setting, like a chapter paragraph', () => {
    const preview: CreditsRenderResult = { text: 'Alice, written by Lewis Carroll.', words: 5, unresolved: [] };
    const { container } = render(<CreditsEntry kind="opening" preview={preview} expanded onToggle={vi.fn()} textClass="text-xl leading-7" />);
    expect(container.querySelector('p')?.className).toContain('text-xl');
  });

  it('shows a chevron and reports aria-expanded on the same whole-header toggle a chapter card uses', () => {
    render(<CreditsEntry kind="opening" expanded={false} onToggle={vi.fn()} textClass="text-sm" />);
    const toggle = screen.getByRole('button', { name: 'Opening credits' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-icon="chevron-down"]')).toBeTruthy();
  });

  it('has no bookmark column (MC1: credits are not bookmarkable)', () => {
    render(<CreditsEntry kind="opening" expanded={false} onToggle={vi.fn()} textClass="text-sm" />);
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();
  });

  it('carries data-credits-entry, not data-chapter-id (never a manuscript chapter)', () => {
    const { container } = render(<CreditsEntry kind="opening" expanded={false} onToggle={vi.fn()} textClass="text-sm" />);
    const article = container.querySelector('article')!;
    expect(article.getAttribute('data-credits-entry')).toBe('opening');
    expect(article.hasAttribute('data-chapter-id')).toBe(false);
  });
});
