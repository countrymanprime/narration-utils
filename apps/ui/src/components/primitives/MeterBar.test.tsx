// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MeterBar } from './MeterBar';

afterEach(cleanup);

const segments = [
  { key: 'finalized', widthPercent: 40, color: '#3c7a5c', tooltip: 'Finalized: 4 chapters · ~2h 10m finished audio' },
  { key: 'proofing', widthPercent: 20, color: '#7a5cae', tooltip: 'Proofing: 2 chapters · ~1h 5m finished audio' },
];

describe('MeterBar', () => {
  it('is an image named by its label and every segment, so a screen reader hears the breakdown', () => {
    render(<MeterBar label="Recording progress" segments={segments} />);
    const meter = screen.getByRole('img', { name: /^Recording progress: / });
    expect(meter.getAttribute('aria-label')).toBe(
      'Recording progress: Finalized: 4 chapters · ~2h 10m finished audio; Proofing: 2 chapters · ~1h 5m finished audio',
    );
  });

  it('is named by its label alone when it has no segments', () => {
    render(<MeterBar label="Recording progress" segments={[]} />);
    expect(screen.getByRole('img', { name: 'Recording progress' })).toBeTruthy();
  });

  it('animates only when the user has not asked for reduced motion', () => {
    const { container } = render(<MeterBar label="Recording progress" segments={segments} />);
    for (const segment of container.querySelectorAll('.progress-segment')) {
      expect(segment.className).toContain('motion-safe:transition-[flex-basis]');
      expect(segment.className.split(/\s+/)).not.toContain('transition-[flex-basis]');
    }
  });
});
