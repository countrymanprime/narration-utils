// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TitleSubtitle } from './TitleSubtitle';

afterEach(cleanup);

describe('TitleSubtitle', () => {
  it('draws the title and subtitle inline, joined by an em dash', () => {
    const { container } = render(<TitleSubtitle title="PROLOGUE" subtitle="The Last Good Applause" />);
    expect(container.textContent).toBe('PROLOGUE — The Last Good Applause');
  });

  it('draws the title alone when there is no subtitle', () => {
    const { container } = render(<TitleSubtitle title="A Message from the Author" />);
    expect(container.textContent).toBe('A Message from the Author');
  });

  it('is never re-cased by an uppercase ancestor', () => {
    const { container } = render(
      <div className="uppercase">
        <TitleSubtitle title="PROLOGUE" subtitle="The Last Good Applause" />
      </div>,
    );
    expect(container.querySelector('span')?.className).toContain('normal-case');
  });

  it('gives the title semibold weight and the subtitle --text-muted, regular', () => {
    render(<TitleSubtitle title="PROLOGUE" subtitle="The Last Good Applause" />);
    expect(screen.getByText('PROLOGUE').className).toContain('font-semibold');
    const subtitle = screen.getByText(/The Last Good Applause/);
    expect(subtitle.className).toContain('font-normal');
    expect(subtitle.className).toContain('text-[var(--text-muted)]');
  });

  it('stacked puts the title over the subtitle, each its own block', () => {
    render(<TitleSubtitle title="PROLOGUE" subtitle="The Last Good Applause" layout="stacked" />);
    const title = screen.getByText('PROLOGUE');
    const subtitle = screen.getByText(/The Last Good Applause/);
    expect(title.className).toContain('block');
    expect(subtitle.className).toContain('block');
  });

  it('gives inline and stacked the same accessible name (a visually hidden dash joins the stacked lines)', () => {
    // \s in JS regex covers U+00A0 too, matching how the accessible-name algorithm collapses whitespace: inline's
    // non-breaking space (keeps the dash on the title's line) and stacked's plain one read the same to a screen reader.
    const squash = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();
    const { container: inlineContainer } = render(<TitleSubtitle title="PROLOGUE" subtitle="The Last Good Applause" />);
    const inlineText = squash(inlineContainer.textContent);
    cleanup();
    const { container: stackedContainer } = render(<TitleSubtitle title="PROLOGUE" subtitle="The Last Good Applause" layout="stacked" />);
    expect(squash(stackedContainer.textContent)).toBe(inlineText);
  });

  it('stacked with no subtitle renders no subtitle line', () => {
    const { container } = render(<TitleSubtitle title="A Message from the Author" layout="stacked" />);
    expect(container.textContent).toBe('A Message from the Author');
  });
});
