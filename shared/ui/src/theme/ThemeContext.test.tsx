// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeContext';
import { THEME_STORAGE_KEY } from './theme';

function matchMediaMock(matches: boolean) {
  const listeners = new Set<() => void>();
  return {
    matches,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    fire: () => listeners.forEach((listener) => listener()),
  };
}

function ThemeProbe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setPreference('dark')}>dark</button>
      <button onClick={() => setPreference('light')}>light</button>
      <button onClick={() => setPreference('system')}>system</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
});

describe('ThemeProvider / useTheme', () => {
  it('throws when useTheme() is called outside a provider', () => {
    const { result } = renderHook(() => {
      try {
        return useTheme();
      } catch (error) {
        return error;
      }
    });
    expect(result.current).toBeInstanceOf(Error);
  });

  it('defaults to system preference and resolves it against matchMedia', () => {
    vi.stubGlobal('matchMedia', () => matchMediaMock(true));
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('preference').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('persists an explicit preference and writes the data-theme attribute', async () => {
    vi.stubGlobal('matchMedia', () => matchMediaMock(false));
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'dark' }));
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('reacts to an OS theme change while on the system preference', () => {
    const media = matchMediaMock(false);
    vi.stubGlobal('matchMedia', () => media);
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    media.matches = true;
    act(() => media.fire());
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reads a previously stored preference on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    vi.stubGlobal('matchMedia', () => matchMediaMock(false));
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('preference').textContent).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });
});
