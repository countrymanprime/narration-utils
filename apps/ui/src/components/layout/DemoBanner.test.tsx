// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('DemoBanner', () => {
  it('renders nothing when VITE_DEMO is unset, so it never appears in a mock-build capture', async () => {
    vi.stubEnv('VITE_DEMO', undefined);
    const { DemoBanner } = await import('./DemoBanner');
    const { container } = render(<DemoBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the demo notice and a link to the source when VITE_DEMO=1', async () => {
    vi.stubEnv('VITE_DEMO', '1');
    const { DemoBanner } = await import('./DemoBanner');
    render(<DemoBanner />);
    expect(screen.getByText(/nothing you do here is saved/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: /view source/i });
    expect(link.getAttribute('href')).toBe('https://github.com/countrymanprime/narration-utils');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
