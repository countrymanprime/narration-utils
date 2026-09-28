// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SECTION_LABEL_CLASS, SectionLabel } from './SectionLabel';

afterEach(cleanup);

describe('SectionLabel', () => {
  it('is a span by default, in the label type', () => {
    render(<SectionLabel>Outputs</SectionLabel>);
    const label = screen.getByText('Outputs');
    expect(label.tagName).toBe('SPAN');
    expect(label.className).toContain('var(--font-size-label)');
    expect(label.className).toContain('var(--tracking-label)');
    expect(label.className).toContain('uppercase');
  });

  it('renders the element `as` names, with the same look', () => {
    render(
      <SectionLabel as="h3" id="outputs">
        Outputs
      </SectionLabel>,
    );
    const heading = screen.getByRole('heading', { level: 3, name: 'Outputs' });
    expect(heading.id).toBe('outputs');
    expect(heading.className.startsWith(SECTION_LABEL_CLASS)).toBe(true);
  });

  it('adds a layout class after its own', () => {
    render(<SectionLabel className="mb-2">Outputs</SectionLabel>);
    expect(screen.getByText('Outputs').className.endsWith('mb-2')).toBe(true);
  });
});
