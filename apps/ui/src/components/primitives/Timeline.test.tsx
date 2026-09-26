// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { danglingAriaReferences } from './ariaReferences';
import { Timeline, TimelineLane, type TimelineMarker } from './Timeline';

afterEach(cleanup);

const MARKERS: TimelineMarker[] = [
  { id: 'm1', at: 4, tone: 'danger', label: "Mispronounced 'epitome'" },
  { id: 'm2', at: 64, tone: 'warning', label: 'Traffic noise' },
  { id: 'm3', at: 130, tone: 'info', label: 'Pacing dips' },
];

describe('Timeline', () => {
  it('positions a marker as a percentage of the duration, so it never overflows sideways', () => {
    render(
      <Timeline duration={200}>
        <TimelineLane label="Proof notes" duration={200} markers={MARKERS} onActivate={() => undefined} />
      </Timeline>,
    );
    const marker = screen.getByRole('button', { name: "0:04, Mispronounced 'epitome'" });
    expect(marker.style.left).toBe('2%');
  });

  it('names each marker by its time and label, and no aria reference dangles', () => {
    const { container } = render(
      <Timeline duration={200}>
        <TimelineLane label="Proof notes" duration={200} markers={MARKERS} onActivate={() => undefined} />
      </Timeline>,
    );
    expect(screen.getByRole('group', { name: 'Proof notes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1:04, Traffic noise' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2:10, Pacing dips' })).toBeTruthy();
    expect(danglingAriaReferences(container)).toEqual([]);
  });

  it('is one tab stop: only the first marker is in the tab order until focus moves', () => {
    render(
      <Timeline duration={200}>
        <TimelineLane label="Proof notes" duration={200} markers={MARKERS} onActivate={() => undefined} />
      </Timeline>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
  });

  it('steps focus between markers with the arrow keys, without activating', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(
      <Timeline duration={200}>
        <TimelineLane label="Proof notes" duration={200} markers={MARKERS} onActivate={onActivate} />
      </Timeline>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: "0:04, Mispronounced 'epitome'" }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '1:04, Traffic noise' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '2:10, Pacing dips' }));
    // The last marker stays put past the end.
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '2:10, Pacing dips' }));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '1:04, Traffic noise' }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('Home and End jump to the first and last marker', async () => {
    const user = userEvent.setup();
    render(
      <Timeline duration={200}>
        <TimelineLane label="Proof notes" duration={200} markers={MARKERS} onActivate={() => undefined} />
      </Timeline>,
    );
    await user.tab();
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '2:10, Pacing dips' }));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: "0:04, Mispronounced 'epitome'" }));
  });

  it('Enter and Space activate the focused marker, reporting its id', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(
      <Timeline duration={200}>
        <TimelineLane label="Proof notes" duration={200} markers={MARKERS} onActivate={onActivate} />
      </Timeline>,
    );
    await user.tab();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onActivate).toHaveBeenCalledWith('m2');
    await user.keyboard(' ');
    expect(onActivate).toHaveBeenLastCalledWith('m2');
  });

  it('activates by click, reporting the pressed marker even when it was not the tab stop', async () => {
    const onActivate = vi.fn();
    render(
      <Timeline duration={200}>
        <TimelineLane label="Proof notes" duration={200} markers={MARKERS} onActivate={onActivate} />
      </Timeline>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: '2:10, Pacing dips' }));
    expect(onActivate).toHaveBeenCalledWith('m3');
  });

  it('marks a decorative backdrop aria-hidden and draws no audio itself', () => {
    render(
      <Timeline duration={200} backdrop={<svg data-testid="waveform" />}>
        <TimelineLane label="Proof notes" duration={200} markers={[]} onActivate={() => undefined} />
      </Timeline>,
    );
    const backdrop = screen.getByTestId('waveform').parentElement;
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws the playhead as a decorative line, positioned as a percentage of the duration', () => {
    const { container } = render(
      <Timeline duration={200} playhead={50}>
        <TimelineLane label="Proof notes" duration={200} markers={[]} onActivate={() => undefined} />
      </Timeline>,
    );
    const playhead = container.querySelector('[aria-hidden="true"].bg-\\[var\\(--accent\\)\\]') as HTMLElement | null;
    expect(playhead).not.toBeNull();
    expect(playhead?.style.left).toBe('25%');
  });

  it('renders an empty lane with no markers and no error', () => {
    render(
      <Timeline duration={200}>
        <TimelineLane label="Proof notes" duration={200} markers={[]} onActivate={() => undefined} />
      </Timeline>,
    );
    expect(screen.getByRole('group', { name: 'Proof notes' }).children).toHaveLength(0);
  });
});
