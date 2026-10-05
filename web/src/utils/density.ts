/** Compact messages: tighter spacing, more on screen. A choice per device, kept in the browser. */
export const DENSITY_KEY = 'chatDensity';

export function loadCompact(): boolean {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact';
  } catch {
    return false;
  }
}

/** Applies the choice to the page at once and remembers it (public/theme-boot.js applies it on the next load). */
export function setCompact(compact: boolean): void {
  document.body.dataset.density = compact ? 'compact' : 'comfortable';
  try {
    localStorage.setItem(DENSITY_KEY, compact ? 'compact' : 'comfortable');
  } catch {
    /* the choice still holds for this visit */
  }
}
