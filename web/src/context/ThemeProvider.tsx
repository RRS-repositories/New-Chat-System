import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyTheme,
  loadTheme,
  sameTheme,
  saveTheme,
  type Theme,
  type ThemeAccent,
  type ThemeMode,
} from '../utils/theme.ts';

type ThemeContextValue = Theme & {
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
  /** Replaces the whole theme (used when the saved choice arrives from the server). */
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}

/**
 * Holds the colour theme and keeps the page and this browser's storage in step with it.
 * It wraps the sign-in page too, so the theme is right before anyone has signed in.
 * Following the person across devices is done by ThemeSync, once the chat has loaded.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState((prev) => (sameTheme(prev, next) ? prev : next)), []);
  const setMode = useCallback((mode: ThemeMode) => setThemeState((prev) => ({ ...prev, mode })), []);
  const setAccent = useCallback((accent: ThemeAccent) => setThemeState((prev) => ({ ...prev, accent })), []);

  const value = useMemo(() => ({ ...theme, setMode, setAccent, setTheme }), [theme, setMode, setAccent, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
