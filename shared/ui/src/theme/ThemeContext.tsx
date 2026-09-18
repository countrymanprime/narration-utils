import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { applyResolvedTheme, readStoredPreference, resolveTheme, systemTheme, THEME_STORAGE_KEY, type ResolvedTheme, type ThemePreference } from './theme';

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};

// The single injection point for theme state: components read/change the
// theme through useTheme() instead of touching localStorage or the
// data-theme attribute directly. Mirrors ApiContext.tsx's provider/hook shape.
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => readStoredPreference());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));

  useEffect(() => {
    const next = resolveTheme(preference);
    setResolved(next);
    applyResolvedTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Preference just won't persist across reloads (e.g. storage disabled) - not fatal.
    }
  }, [preference]);

  useEffect(() => {
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const next = systemTheme();
      setResolved(next);
      applyResolvedTheme(next);
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [preference]);

  return <ThemeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme() called outside a <ThemeProvider>.');
  return context;
}
