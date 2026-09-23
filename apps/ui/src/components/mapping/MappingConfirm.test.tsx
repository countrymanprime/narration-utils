// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MappingConfirm } from './MappingConfirm';
import type { Track } from '../../types';

afterEach(cleanup);

const tracks: Track[] = [
  { guid: 'guid-1', index: 0, name: 'Chapter 1', color: '', muted: false, soloed: false, items: [] },
  { guid: 'guid-2', index: 1, name: 'Chapter 2', color: '', muted: false, soloed: false, items: [] },
];

describe('MappingConfirm', () => {
  it('offers a track picker and confirms the chosen track when nothing is linked yet', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<MappingConfirm chapterTitle="Chapter One" tracks={tracks} onConfirm={onConfirm} onClear={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Track for Chapter One' }), 'guid-2');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledWith('guid-2');
  });

  it('shows the linked track name with Change and Clear once a link is confirmed', () => {
    render(
      <MappingConfirm chapterTitle="Chapter One" tracks={tracks} linkedTrackGuid="guid-1" linkedTrackName="Chapter 1" onConfirm={vi.fn()} onClear={vi.fn()} />,
    );

    expect(screen.getByText('Chapter 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });

  it('switches back to the picker on Change, and Confirm re-links to a new track', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <MappingConfirm
        chapterTitle="Chapter One"
        tracks={tracks}
        linkedTrackGuid="guid-1"
        linkedTrackName="Chapter 1"
        onConfirm={onConfirm}
        onClear={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Track for Chapter One' }), 'guid-2');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledWith('guid-2');
  });

  it('calls onClear when Clear is pressed', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <MappingConfirm chapterTitle="Chapter One" tracks={tracks} linkedTrackGuid="guid-1" linkedTrackName="Chapter 1" onConfirm={vi.fn()} onClear={onClear} />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onClear).toHaveBeenCalled();
  });

  it('shows a missing-track message when the linked track no longer resolves to a name', () => {
    render(<MappingConfirm chapterTitle="Chapter One" tracks={tracks} linkedTrackGuid="guid-missing" onConfirm={vi.fn()} onClear={vi.fn()} />);

    expect(screen.getByText('Linked track is missing from this project')).toBeTruthy();
  });

  it('says there is nothing to link when the project has no tracks', () => {
    render(<MappingConfirm chapterTitle="Chapter One" tracks={[]} onConfirm={vi.fn()} onClear={vi.fn()} />);

    expect(screen.getByText('No REAPER tracks to link')).toBeTruthy();
  });
});
