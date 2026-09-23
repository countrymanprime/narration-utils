// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditsEntry } from './CreditsEntry';
import type { CreditsRenderResult } from '../../types';

afterEach(cleanup);

describe('CreditsEntry (Manuscript pseudo-entry for opening/closing credits, PRD audiobook-credits-templates.prd.md Phase 3)', () => {
  it('shows the kind label and is collapsed when expanded=false, with no preview text rendered', () => {
    render(<CreditsEntry kind="opening" expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Opening credits' })).toBeTruthy();
    expect(screen.queryByText(/Nothing to preview yet/)).toBeNull();
  });

  it('shows rendered credits text and word count when expanded with a fully-resolved preview', () => {
    const preview: CreditsRenderResult = { text: 'Alice, written by Lewis Carroll, narrated by You.', words: 7, unresolved: [] };
    render(<CreditsEntry kind="opening" preview={preview} expanded onToggle={vi.fn()} />);
    expect(screen.getByText('Alice, written by Lewis Carroll, narrated by You.')).toBeTruthy();
    expect(screen.getByText(/7 words/)).toBeTruthy();
  });

  it('renders an unresolved token as a highlighted chip and reports the unresolved count, never as silent empty text (C6)', () => {
    const preview: CreditsRenderResult = { text: '[Title], written by [Author], narrated by You.', words: 6, unresolved: ['Title', 'Author'] };
    render(<CreditsEntry kind="closing" preview={preview} expanded onToggle={vi.fn()} />);
    expect(screen.getByText('[Title]')).toBeTruthy();
    expect(screen.getByText('[Author]')).toBeTruthy();
    expect(screen.getByText(/2 unresolved tokens: Title, Author/)).toBeTruthy();
  });

  it('calls onToggle when the header is activated, and reflects aria-expanded', () => {
    const onToggle = vi.fn();
    render(<CreditsEntry kind="closing" expanded={false} onToggle={onToggle} />);
    screen.getByRole('button', { name: /Closing credits/ }).click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('labels closing credits distinctly from opening credits', () => {
    render(<CreditsEntry kind="closing" expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Closing credits' })).toBeTruthy();
  });
});
