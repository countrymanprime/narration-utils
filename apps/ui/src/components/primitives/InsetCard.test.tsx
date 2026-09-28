// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InsetCard } from './InsetCard';

afterEach(cleanup);

describe('InsetCard', () => {
  it('is a div with a 1 px border frame, a 6 px radius and 12 px inside', () => {
    render(<InsetCard>Body</InsetCard>);
    const card = screen.getByText('Body');
    expect(card.tagName).toBe('DIV');
    expect(card.className).toContain('rounded-md');
    expect(card.className).toContain('border');
    expect(card.className).toContain('p-3');
    expect(card.style.borderColor).toBe('var(--border)');
    expect(card.style.background).toBe('');
  });

  it('colours the frame by tone, fills and dashes on request', () => {
    render(
      <InsetCard tone="danger" fill dashed>
        Body
      </InsetCard>,
    );
    const card = screen.getByText('Body');
    expect(card.style.borderColor).toBe('var(--danger)');
    expect(card.style.background).toBe('var(--surface-2)');
    expect(card.className).toContain('border-dashed');
  });

  it('renders the element `as` names with its role and name', () => {
    render(
      <ul>
        <InsetCard as="li">Read</InsetCard>
      </ul>,
    );
    expect(screen.getByRole('listitem').textContent).toBe('Read');
    cleanup();
    render(
      <InsetCard as="section" aria-label="Online dictionary">
        Body
      </InsetCard>,
    );
    expect(screen.getByRole('region', { name: 'Online dictionary' })).toBeTruthy();
    cleanup();
    render(
      <InsetCard as="p" role="alert">
        Failed
      </InsetCard>,
    );
    expect(screen.getByRole('alert').tagName).toBe('P');
  });
});
