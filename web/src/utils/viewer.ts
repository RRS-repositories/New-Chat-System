/** A picture narrower than this share of the window is scaled up in the viewer, at most this many times. */
export const SMALL_SHARE = 0.6;
export const MAX_UPSCALE = 3;

/**
 * How wide to show a picture in the viewer. Big pictures fit the window (CSS does that); a small one
 * (a cropped screenshot, say) is scaled up so it can be read, never beyond three times its size and
 * never wider than the window allows. null: leave it to CSS.
 */
export function viewerWidth(natural: number, viewport: number): number | null {
  if (!natural || !viewport) return null;
  if (natural >= viewport * SMALL_SHARE) return null;
  return Math.min(natural * MAX_UPSCALE, viewport * 0.92);
}
