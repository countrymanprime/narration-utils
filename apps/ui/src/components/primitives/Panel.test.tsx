// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';
import { danglingAriaReferences } from './ariaReferences';
import { Panel, PanelHeader } from './Panel';

afterEach(cleanup);

describe('Panel', () => {
  it('is an unnamed surface without a title, and renders no header row', () => {
    const { container } = render(<Panel>Just text</Panel>);
    expect(container.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('with a title is a region named by its own level-2 heading', () => {
    render(<Panel title="Choose manuscript chapter">Body</Panel>);
    const region = screen.getByRole('region', { name: 'Choose manuscript chapter' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Choose manuscript chapter' })).toBeTruthy();
    expect(danglingAriaReferences()).toEqual([]);
  });

  it('gives two titled panels two different ids', () => {
    render(
      <>
        <Panel title="First">a</Panel>
        <Panel title="Second">b</Panel>
      </>,
    );
    const ids = screen.getAllByRole('heading').map((heading) => heading.id);
    expect(new Set(ids).size).toBe(2);
    expect(screen.getByRole('region', { name: 'First' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Second' })).toBeTruthy();
  });

  it('puts actions in the header row beside the title and keeps them clickable', () => {
    let used = 0;
    render(
      <Panel
        title="Choose a REAPER project file"
        actions={
          <>
            <Button variant="secondary">Rescan folder</Button>
            <Button onClick={() => (used += 1)}>Use this file</Button>
          </>
        }
      >
        Body
      </Panel>,
    );
    const region = screen.getByRole('region', { name: 'Choose a REAPER project file' });
    const headerRow = within(region).getByRole('heading', { level: 2 }).parentElement!.parentElement!;
    // The buttons share the row the title is in, beside it, and stay clickable.
    expect(within(headerRow).getByRole('button', { name: 'Rescan folder' })).toBeTruthy();
    within(headerRow).getByRole('button', { name: 'Use this file' }).click();
    expect(used).toBe(1);
  });

  it('keeps the surface look whether or not it has a title', () => {
    const { container, rerender } = render(<Panel>Body</Panel>);
    const bare = container.querySelector('section')!.className;
    rerender(<Panel title="Titled">Body</Panel>);
    expect(container.querySelector('section')!.className).toBe(bare);
  });
});

describe('Panel header, subtitle and body', () => {
  it('puts the subtitle in the header row, after the title', () => {
    render(
      <Panel title="Per-file checks" subtitle="measured on the rendered files">
        Body
      </Panel>,
    );
    const title = screen.getByRole('heading', { level: 2, name: 'Per-file checks' });
    const row = title.parentElement!;
    expect(within(row).getByText('measured on the rendered files')).toBeTruthy();
    // The subtitle is not part of the region's name.
    expect(screen.getByRole('region', { name: 'Per-file checks' })).toBeTruthy();
  });

  it('draws the title in the card-title type and the header over a divider', () => {
    render(<Panel title="Mastering chain">Body</Panel>);
    const title = screen.getByRole('heading', { level: 2 });
    expect(title.className).toContain('var(--font-size-card-title)');
    expect(title.className).toContain('Barlow_Condensed');
    expect(title.parentElement!.parentElement!.className).toContain('border-b');
  });

  it('pads the body, and a flush panel does not', () => {
    const { container, rerender } = render(<Panel title="Tracks">Body</Panel>);
    const body = () => container.querySelector('section > div:last-child')!;
    expect(body().textContent).toBe('Body');
    expect(body().className).toContain('p-[var(--panel-pad)]');
    rerender(
      <Panel title="Tracks" flush>
        Body
      </Panel>,
    );
    expect(body().className).not.toContain('p-[var(--panel-pad)]');
    expect(body().className).toContain('[--panel-pad:0px]');
  });

  it('names a bare panel by `label`', () => {
    render(<Panel label="Where you stopped">Body</Panel>);
    expect(screen.getByRole('region', { name: 'Where you stopped' })).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('draws what leads the title before it', () => {
    render(
      <Panel title="Marra Venn" leading={<span data-testid="dot" />}>
        Body
      </Panel>,
    );
    const row = screen.getByRole('heading', { level: 2 }).parentElement!;
    expect(row.firstElementChild!.contains(screen.getByTestId('dot'))).toBe(true);
  });

  it('frames a review panel in the review colour and scrolls a `scroll` body', () => {
    const { container, rerender } = render(<Panel tone="review">Body</Panel>);
    expect((container.querySelector('section') as HTMLElement).style.borderColor).toBe('var(--review)');
    rerender(
      <Panel title="Aliases" scroll className="h-64">
        Body
      </Panel>,
    );
    const section = container.querySelector('section')!;
    expect(section.className).toContain('h-64');
    expect(section.className).toContain('flex-col');
    expect(section.querySelector(':scope > div:last-child')!.className).toContain('overflow-y-auto');
  });
});

describe('PanelHeader', () => {
  it('draws the header row on its own, its title carrying the id the caller names its surface by', () => {
    render(
      <div role="group" aria-labelledby="settings-title">
        <PanelHeader title="Keyboard" titleId="settings-title" subtitle="Global defaults" />
      </div>,
    );
    expect(screen.getByRole('group', { name: 'Keyboard' })).toBeTruthy();
    expect(screen.getByText('Global defaults')).toBeTruthy();
  });
});
