/** The colour theme a person chose: light or dark, and one of five accents. Pure helpers plus browser storage. */

export const ACCENTS = {
  violet: { label: 'Violet', swatch: 'linear-gradient(120deg,#8F76F5,#6C4DE6)' },
  ocean: { label: 'Ocean', swatch: 'linear-gradient(120deg,#3FA3FF,#0B84F3)' },
  sunset: { label: 'Sunset', swatch: 'linear-gradient(120deg,#FF7A45,#FF4365)' },
  emerald: { label: 'Emerald', swatch: 'linear-gradient(120deg,#35E09A,#0FB573)' },
  magenta: { label: 'Magenta', swatch: 'linear-gradient(120deg,#FF5BCB,#E31FA9)' },
} as const;

export type ThemeMode = 'light' | 'dark';
export type ThemeAccent = keyof typeof ACCENTS;
export type Theme = { mode: ThemeMode; accent: ThemeAccent };

export const DEFAULT_THEME: Theme = { mode: 'light', accent: 'violet' };
/** The key the page-load script (public/theme-boot.js) reads too: keep the two in step. */
export const THEME_STORAGE_KEY = 'chatTheme';

/** Anything → a valid theme. Unknown or missing parts fall back to the defaults. */
export function cleanTheme(value: unknown): Theme {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    mode: v.mode === 'dark' ? 'dark' : 'light',
    accent: typeof v.accent === 'string' && Object.hasOwn(ACCENTS, v.accent) ? (v.accent as ThemeAccent) : 'violet',
  };
}

export const sameTheme = (a: Theme, b: Theme) => a.mode === b.mode && a.accent === b.accent;

export function loadTheme(): Theme {
  try {
    return cleanTheme(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || '{}'));
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    /* private mode: the theme still applies for this visit */
  }
}

/** Puts the theme on the page. Every colour in the stylesheets follows these two attributes. */
export function applyTheme(theme: Theme): void {
  document.body.dataset.mode = theme.mode;
  document.body.dataset.accent = theme.accent;
}
