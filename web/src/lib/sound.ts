let ctx: AudioContext | null = null; let last = 0;
/** A short, quiet beep for a message arriving somewhere you are not looking. At most one per 2 s. */
export function playNotify() {
  const now = Date.now(); if (now - last < 2000) return; last = now;
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.12);
  } catch { /* no audio permission yet */ }
}
