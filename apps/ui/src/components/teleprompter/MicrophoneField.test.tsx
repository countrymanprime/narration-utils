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

// The picker (docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 2, "Microphone is never typed" Decisions
// Log row): a dropdown of enumerated devices only, never a typed field. A failed or empty listing blocks the phase
// instead of offering one.
describe('MicrophoneField', () => {
  it('labels the control "Microphone"', () => {
    render(<MicrophoneField value="" onChange={() => {}} devices={DEVICES} />);

    expect(screen.getByLabelText('Microphone')).not.toBeNull();
  });

  it('lists the enumerated devices as options, plus a placeholder, and no "Other…" entry', () => {
    render(<MicrophoneField value="" onChange={() => {}} devices={DEVICES} />);

    const select = screen.getByLabelText('Microphone') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((option) => option.textContent);
    expect(optionLabels).toEqual(['Choose a microphone…', 'Microphone Array (Realtek(R) Audio)', 'Headset Microphone (USB Audio Device)']);
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

  it('has no free-text input at all, in any state', () => {
    const { container, rerender } = render(<MicrophoneField value="" onChange={() => {}} devices={DEVICES} />);
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();

    rerender(<MicrophoneField value="Old USB Mic" onChange={() => {}} devices={DEVICES} />);
    expect(container.querySelector('input')).toBeNull();

    rerender(<MicrophoneField value="" onChange={() => {}} devices={[]} />);
    expect(container.querySelector('input')).toBeNull();
  });

  it('blocks with a clear message when the enumerated list is empty, and offers no dropdown', () => {
    render(<MicrophoneField value="" onChange={() => {}} devices={[]} />);

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/No microphone found/);
  });

  it('blocks with a distinct message when the listing failed, rather than an empty-but-fine list', () => {
    render(<MicrophoneField value="" onChange={() => {}} devices={[]} error="Could not list input devices" />);

    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't list microphones/);
    expect(screen.getByText('Could not list input devices')).not.toBeNull();
  });

  it('offers a refresh action from the blocked, empty-list state', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<MicrophoneField value="" onChange={() => {}} devices={[]} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows a listing error without hiding the control when devices are still listed', () => {
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

// Keeps the ControlledMicrophoneField helper exercised (device persistence across a re-pick), even though the typed
// "Other…" round trip it used to cover is gone.
describe('MicrophoneField (controlled)', () => {
  it('keeps the chosen device selected after a re-render with the same devices', async () => {
    const user = userEvent.setup();
    render(<ControlledMicrophoneField />);

    await user.selectOptions(screen.getByLabelText('Microphone'), 'Headset Microphone (USB Audio Device)');

    expect((screen.getByLabelText('Microphone') as HTMLSelectElement).value).toBe('Headset Microphone (USB Audio Device)');
  });
});
