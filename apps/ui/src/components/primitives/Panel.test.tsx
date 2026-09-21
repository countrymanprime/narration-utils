// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';
import { danglingAriaReferences } from './ariaReferences';
import { Panel } from './Panel';

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
            <Button variant="ghost">Rescan folder</Button>
            <Button onClick={() => (used += 1)}>Use this file</Button>
          </>
        }
      >
        Body
      </Panel>,
    );
    const region = screen.getByRole('region', { name: 'Choose a REAPER project file' });
    within(region).getByRole('button', { name: 'Use this file' }).click();
    expect(used).toBe(1);
    expect(within(region).getByRole('button', { name: 'Rescan folder' })).toBeTruthy();
  });

  it('keeps the surface look whether or not it has a title', () => {
    const { container, rerender } = render(<Panel>Body</Panel>);
    const bare = container.querySelector('section')!.className;
    rerender(<Panel title="Titled">Body</Panel>);
    expect(container.querySelector('section')!.className).toBe(bare);
  });
});
