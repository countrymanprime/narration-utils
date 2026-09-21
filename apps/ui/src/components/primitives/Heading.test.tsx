// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Heading } from './Heading';

afterEach(cleanup);

describe('Heading', () => {
  it('is the page heading, level 1, unless it is given a level', () => {
    render(<Heading title="Settings" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
  });

  it.each([1, 2, 3] as const)('renders level %i as that heading tag', (level) => {
    render(<Heading title="Tracks" level={level} />);
    expect(screen.getByRole('heading', { level, name: 'Tracks' }).tagName).toBe(`H${level}`);
  });

  it('looks the same at every level: the level changes the tag, not the type', () => {
    const classes = [1, 2, 3].map((level) => {
      const { unmount } = render(<Heading title="Tracks" level={level as 1 | 2 | 3} />);
      const { className } = screen.getByRole('heading');
      unmount();
      return className;
    });
    expect(new Set(classes).size).toBe(1);
  });

  it('wraps a long unbroken subtitle instead of overflowing sideways', () => {
    render(<Heading title="Tracks">{'The_Very_Long_Running_Series_Book_Three_The_Reckoning_chapter_twenty_seven_revised_v14_FINAL.rpp'}</Heading>);
    const subtitle = screen.getByText(/The_Very_Long/);
    expect(subtitle.tagName).toBe('P');
    expect(subtitle.className).toContain('[overflow-wrap:anywhere]');
  });

  it('leaves no empty subtitle paragraph without children', () => {
    const { container } = render(<Heading title="Settings" />);
    expect(container.querySelector('p')).toBeNull();
  });
});
