export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'narration-ui-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

// matchMedia isn't implemented in jsdom (the unit-test DOM) and could be
// absent from an embedding webview - treat it as "no preference" rather than
// throwing.
export function systemTheme(): ResolvedTheme {
  if (typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

// `data-theme='dark'` is the only state the CSS in styles.css branches on -
// light is simply the attribute's absence, so there's nothing to write for it.
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (resolved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

export function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}
