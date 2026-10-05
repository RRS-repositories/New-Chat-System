import { useEffect } from 'react';
import { useChat } from '../../context/chatContext.ts';
import { useTheme } from '../../context/ThemeProvider.tsx';

/**
 * Makes the theme follow the person across devices: when their saved choice arrives from the
 * server (at sign-in, or after it was changed on another device) this browser takes it.
 * Draws nothing.
 */
export function ThemeSync() {
  const { state } = useChat();
  const { setTheme } = useTheme();
  const saved = state.prefs.theme;
  useEffect(() => {
    if (saved) setTheme(saved);
  }, [saved?.mode, saved?.accent, setTheme]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
