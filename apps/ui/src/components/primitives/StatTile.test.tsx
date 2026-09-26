// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatTile } from './StatTile';

afterEach(cleanup);

describe('StatTile', () => {
  it('renders the label and value', () => {
    render(<StatTile label="Text present" value="84%" />);
    expect(screen.getByText('Text present')).toBeTruthy();
    expect(screen.getByText('84%')).toBeTruthy();
  });

  it('renders the hint when given, and omits it otherwise', () => {
    const { rerender } = render(<StatTile label="Paragraphs" value="9 of 12" hint="fully read" />);
    expect(screen.getByText('fully read')).toBeTruthy();
    rerender(<StatTile label="Paragraphs" value="9 of 12" />);
    expect(screen.queryByText('fully read')).toBeNull();
  });

  it('renders the unit next to the value, and omits it otherwise', () => {
    const { rerender, container } = render(<StatTile label="Pace" value="118" unit="/min" />);
    expect(screen.getByText('/min')).toBeTruthy();
    rerender(<StatTile label="Pace" value="118" />);
    expect(container.textContent).not.toContain('/min');
  });

  it('defaults to neutral tone: the value carries no tone colour', () => {
    render(<StatTile label="Paragraphs" value="9 of 12" />);
    expect(screen.getByText('9 of 12').style.color).toBe('');
  });

  it.each([
    ['success', 'var(--ok-text)'],
    ['warning', 'var(--warn-text)'],
    ['danger', 'var(--danger-text)'],
    ['info', 'var(--info-text)'],
    ['experimental', 'var(--experimental-text)'],
  ] as const)('tints the value %s with its tone colour', (tone, color) => {
    render(<StatTile label="Delivery check" value="7 of 12" tone={tone} />);
    expect(screen.getByText('7 of 12').style.color).toBe(color);
  });

  it('draws no meter without a progress value', () => {
    render(<StatTile label="Text present" value="84%" />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('draws a progress bar named after the label when given a progress value', () => {
    render(<StatTile label="Finished audio" value="6.2 of 9 h" progress={0.42} />);
    const bar = screen.getByRole('progressbar', { name: 'Finished audio' });
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
  });
});
