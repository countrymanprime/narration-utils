// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CompactShell } from './CompactShell';

afterEach(cleanup);

describe('CompactShell', () => {
  it('is a header landmark named by its title, above a main landmark holding the sections', () => {
    render(
      <CompactShell title="Companion">
        <p>Section body</p>
      </CompactShell>,
    );
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('heading', { level: 1, name: 'Companion' })).toBeTruthy();
    expect(screen.getByRole('main').textContent).toContain('Section body');
  });

  it('renders no status or action when neither is given', () => {
    render(<CompactShell title="Companion">Body</CompactShell>);
    const banner = screen.getByRole('banner');
    // Only the title heading lives in the header when status and action are both omitted.
    expect(within(banner).getAllByRole('heading')).toHaveLength(1);
    expect(within(banner).queryByRole('button')).toBeNull();
  });

  it('puts status beside the title and the action after it, both inside the header', () => {
    render(
      <CompactShell title="Companion" status={<span>Following playhead</span>} action={<button type="button">Full app</button>}>
        Body
      </CompactShell>,
    );
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('Following playhead')).toBeTruthy();
    const action = within(banner).getByRole('button', { name: 'Full app' });
    expect(action).toBeTruthy();
    // The action follows the title and status in reading order, so a screen reader hears what the panel is
    // and what it's doing before it hears the one thing it can do.
    const title = within(banner).getByRole('heading', { level: 1, name: 'Companion' });
    expect(title.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps sections in the order the caller gave them, inside the main landmark', () => {
    render(
      <CompactShell title="Companion">
        <p>Script</p>
        <p>Pickups</p>
      </CompactShell>,
    );
    const main = screen.getByRole('main');
    const script = within(main).getByText('Script');
    const pickups = within(main).getByText('Pickups');
    expect(script.compareDocumentPosition(pickups) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has exactly one banner and one main, with no title outside the header', () => {
    render(
      <CompactShell title="Companion" status={<span>Live</span>} action={<button type="button">Full app</button>}>
        <p>Body</p>
      </CompactShell>,
    );
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
