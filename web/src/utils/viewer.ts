/**
 * How big a picture is shown in the viewer, and how zooming moves from there.
 *
 * A picture opens so that the WHOLE of it is on the screen: a big one is shrunk to fit the window,
 * a small one (a cropped screenshot, say) is enlarged so it can be read, but never past twice its
 * size and never past the window in either direction. From there the person zooms in and out as
 * they like; a zoomed-in picture scrolls rather than being cut off.
 */
export type Size = { width: number; height: number };

/** A picture smaller than this share of the window, both ways, counts as small and is enlarged. */
export const SMALL_SHARE = 0.6;
/** A small picture is enlarged at most this many times. */
export const MAX_UPSCALE = 2;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;
/** One press of + or − multiplies or divides the size by this. */
export const ZOOM_STEP = 1.25;

const round = (n: number) => Math.round(n * 100) / 100;

/** The largest scale at which the whole picture fits in the space given. */
export function fitScale(natural: Size, space: Size): number {
  if (!natural.width || !natural.height || !space.width || !space.height) return 1;
  return Math.min(space.width / natural.width, space.height / natural.height);
}

/** The scale a picture opens at: fits the space, never enlarged past twice (small) or once (big). */
export function openingScale(natural: Size, space: Size): number {
  if (!natural.width || !natural.height || !space.width || !space.height) return 1;
  const small = natural.width < space.width * SMALL_SHARE && natural.height < space.height * SMALL_SHARE;
  return round(Math.min(fitScale(natural, space), small ? MAX_UPSCALE : 1));
}

/** One zoom step in or out from the current scale, kept within the limits. */
export function zoomed(scale: number, direction: 1 | -1): number {
  const next = direction > 0 ? scale * ZOOM_STEP : scale / ZOOM_STEP;
  return round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
}

/** A double-click: to actual size, or back to the opening size when already there. */
export function toggledScale(scale: number, opening: number): number {
  return Math.abs(scale - 1) < 0.01 ? opening : 1;
}

export const percent = (scale: number) => `${Math.round(scale * 100)}%`;
