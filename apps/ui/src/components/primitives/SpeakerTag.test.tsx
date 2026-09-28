// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { speakerColorIndex } from './speakerColor';
import { SpeakerTag } from './SpeakerTag';

afterEach(cleanup);

describe('SpeakerTag', () => {
  it('renders the label with the data-speaker-tag marker, static by default', () => {
    render(<SpeakerTag label="Alice" />);
    const tag = screen.getByText('Alice');
    expect(tag.getAttribute('data-speaker-tag')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('gives the same speaker id the same colour token every time', () => {
    render(
      <>
        <SpeakerTag label="the Queen" speakerId="queen-1" />
        <SpeakerTag label="Her Majesty" speakerId="queen-1" />
      </>,
    );
    const [first, second] = screen.getAllByText(/Queen|Majesty/);
    expect(first.style.color).toBe(second.style.color);
  });

  it('falls back to hashing the label when no speakerId is given', () => {
    render(<SpeakerTag label="Hatter" />);
    const index = speakerColorIndex('Hatter');
    expect(screen.getByText('Hatter').style.color).toBe(`var(--speaker-${index}-text)`);
  });

  it('becomes an activatable control, with an accessible name, when onActivate is given', () => {
    const onActivate = vi.fn();
    render(<SpeakerTag label="March Hare" onActivate={onActivate} />);
    const button = screen.getByRole('button', { name: 'March Hare' });
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('activates from the keyboard, on Enter and Space', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(<SpeakerTag label="Dormouse" onActivate={onActivate} />);
    await user.tab();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});
