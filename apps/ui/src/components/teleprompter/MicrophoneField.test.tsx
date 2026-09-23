// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicrophoneField } from './MicrophoneField';

afterEach(() => {
  cleanup();
});

function ControlledMicrophoneField({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <MicrophoneField value={value} onChange={setValue} />;
}

// This component is the seam PRD 2 (teleprompter-manuscript-integration) and this PRD's own Phase 2 will swap the
// internals of for a real device picker (docs/prds/teleprompter-engines-and-input-devices.prd.md). Phase 1 only
// relocates the existing typed field, so these tests pin exactly the behavior TeleprompterPage.tsx already had.
describe('MicrophoneField', () => {
  it('labels the control "Microphone" and shows the value it was given', () => {
    render(<MicrophoneField value="Microphone Array (Realtek(R) Audio)" onChange={() => {}} />);

    const field = screen.getByLabelText('Microphone') as HTMLInputElement;
    expect(field.value).toBe('Microphone Array (Realtek(R) Audio)');
  });

  it('describes the field with the Windows Sound settings hint', () => {
    render(<MicrophoneField value="" onChange={() => {}} />);

    const field = screen.getByLabelText('Microphone');
    const description = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('The device name exactly as Windows lists it under Sound settings.');
  });

  it('is still a free-text field (no picker yet): typing updates the value through onChange', async () => {
    const user = userEvent.setup();
    render(<ControlledMicrophoneField />);

    await user.type(screen.getByLabelText('Microphone'), 'USB');

    expect((screen.getByLabelText('Microphone') as HTMLInputElement).value).toBe('USB');
  });

  it('calls onChange with the field text, not a synthetic event', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MicrophoneField value="U" onChange={onChange} />);

    await user.type(screen.getByLabelText('Microphone'), 'S');

    expect(onChange).toHaveBeenCalledWith('US');
  });

  it('shows the placeholder text when empty', () => {
    render(<MicrophoneField value="" onChange={() => {}} />);

    expect(screen.getByPlaceholderText('Microphone (USB Audio Device)')).not.toBeNull();
  });
});
