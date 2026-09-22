// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicrophoneField } from './MicrophoneField';
import type { TeleprompterDevice } from '../../types';

afterEach(() => {
  cleanup();
});

const DEVICES: TeleprompterDevice[] = [{ name: 'Microphone Array (Realtek(R) Audio)' }, { name: 'Headset Microphone (USB Audio Device)' }];

function ControlledMicrophoneField({ initial = '', devices = DEVICES }: { initial?: string; devices?: TeleprompterDevice[] }) {
  const [value, setValue] = useState(initial);
  return <MicrophoneField value={value} onChange={setValue} devices={devices} />;
}

// The picker Phase 2 swaps Phase 1's typed-name seam for (docs/prds/teleprompter-engines-and-input-devices.prd.md
// Phase 2): a dropdown of enumerated devices, with a typed "Other…" fallback for an empty listing or an unlisted
// remembered device.
describe('MicrophoneField', () => {
  it('labels the control "Microphone"', () => {
    render(<MicrophoneField value="" onChange={() => {}} devices={DEVICES} />);

    expect(screen.getByLabelText('Microphone')).not.toBeNull();
  });

  it('lists the enumerated devices as options, plus a placeholder and an Other… entry', () => {
    render(<MicrophoneField value="" onChange={() => {}} devices={DEVICES} />);

    const select = screen.getByLabelText('Microphone') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((option) => option.textContent);
    expect(optionLabels).toEqual(['Choose a microphone…', 'Microphone Array (Realtek(R) Audio)', 'Headset Microphone (USB Audio Device)', 'Other…']);
  });

  it('calls onChange with the chosen device name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MicrophoneField value="" onChange={onChange} devices={DEVICES} />);

    await user.selectOptions(screen.getByLabelText('Microphone'), 'Headset Microphone (USB Audio Device)');

    expect(onChange).toHaveBeenCalledWith('Headset Microphone (USB Audio Device)');
  });

  it('preselects the remembered device when it is in the list', () => {
    render(<MicrophoneField value="Headset Microphone (USB Audio Device)" onChange={() => {}} devices={DEVICES} />);

    expect((screen.getByLabelText('Microphone') as HTMLSelectElement).value).toBe('Headset Microphone (USB Audio Device)');
  });

  it('shows a remembered device that is not in the list as "not found" instead of silently replacing it', () => {
    render(<MicrophoneField value="Old USB Mic" onChange={() => {}} devices={DEVICES} />);

    const select = screen.getByLabelText('Microphone') as HTMLSelectElement;
    expect(select.value).toBe('Old USB Mic');
    expect(screen.getByText('Old USB Mic (not found)')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/not found in the current device list/);
  });

  it('falls back to a typed field when the enumerated list is empty', () => {
    render(<MicrophoneField value="" onChange={() => {}} devices={[]} />);

    const field = screen.getByLabelText('Microphone') as HTMLInputElement;
    expect(field.tagName).toBe('INPUT');
    expect(screen.getByText(/No microphones were found/)).not.toBeNull();
  });

  it('typing into the empty-list fallback calls onChange with the typed text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MicrophoneField value="U" onChange={onChange} devices={[]} />);

    await user.type(screen.getByLabelText('Microphone'), 'S');

    expect(onChange).toHaveBeenCalledWith('US');
  });

  it('switches to a typed "Other…" field when chosen from the list, and back again', async () => {
    const user = userEvent.setup();
    render(<ControlledMicrophoneField />);

    await user.selectOptions(screen.getByLabelText('Microphone'), 'Other…');

    const typed = screen.getByLabelText('Microphone') as HTMLInputElement;
    expect(typed.tagName).toBe('INPUT');
    await user.type(typed, 'Scarlett Solo');
    expect((screen.getByLabelText('Microphone') as HTMLInputElement).value).toBe('Scarlett Solo');

    await user.click(screen.getByRole('button', { name: 'Choose from the list' }));

    expect((screen.getByLabelText('Microphone') as HTMLSelectElement).tagName).toBe('SELECT');
  });

  it('shows a listing error without hiding the control', () => {
    render(<MicrophoneField value="" onChange={() => {}} devices={DEVICES} error="Could not list input devices" />);

    expect(screen.getByRole('alert').textContent).toBe('Could not list input devices');
    expect(screen.getByLabelText('Microphone')).not.toBeNull();
  });

  it('offers a refresh action that calls onRefresh', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<MicrophoneField value="" onChange={() => {}} devices={DEVICES} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
