/**
 * Incoming-call ringtones, made with WebAudio (no audio files), loud: a choice of tones, one kept
 * per device (the owner asked to pick one, 15 Oct 2026). Each tone is a short pattern of notes
 * repeated until stopRingtone() or `maxMs` (the server gives up ringing after 30 s).
 */
let ctx: AudioContext | null = null;
let loop: ReturnType<typeof setInterval> | null = null;
let cap: ReturnType<typeof setTimeout> | null = null;

const KEY = 'chat.ringtone';
/** How loud: the gain of each tone (two at once add up to just under full scale). */
export const RING_GAIN = 0.45;

/** One note of a pattern: when it starts (s), how long (s), its frequencies, and the wave shape. */
type Note = { at: number; len: number; freqs: number[]; wave?: OscillatorType; gain?: number };
export type Ringtone = { id: string; name: string; description: string; periodMs: number; notes: Note[] };

export const RINGTONES: Ringtone[] = [
  {
    id: 'classic',
    name: 'Classic phone',
    description: 'Two bursts of the traditional ring, every two seconds',
    periodMs: 2000,
    notes: [
      { at: 0, len: 0.4, freqs: [400, 450] },
      { at: 0.6, len: 0.4, freqs: [400, 450] },
    ],
  },
  {
    id: 'marimba',
    name: 'Marimba',
    description: 'A rising four-note chime, soft wood',
    periodMs: 2400,
    notes: [
      { at: 0, len: 0.35, freqs: [523], wave: 'triangle' },
      { at: 0.25, len: 0.35, freqs: [659], wave: 'triangle' },
      { at: 0.5, len: 0.35, freqs: [784], wave: 'triangle' },
      { at: 0.75, len: 0.6, freqs: [1047], wave: 'triangle' },
    ],
  },
  {
    id: 'digital',
    name: 'Digital',
    description: 'Quick high chirps, hard to miss',
    periodMs: 1600,
    notes: [
      { at: 0, len: 0.12, freqs: [1200], wave: 'square', gain: 0.3 },
      { at: 0.18, len: 0.12, freqs: [1200], wave: 'square', gain: 0.3 },
      { at: 0.36, len: 0.12, freqs: [1200], wave: 'square', gain: 0.3 },
      { at: 0.6, len: 0.12, freqs: [1600], wave: 'square', gain: 0.3 },
      { at: 0.78, len: 0.12, freqs: [1600], wave: 'square', gain: 0.3 },
    ],
  },
  {
    id: 'bell',
    name: 'Bell',
    description: 'A single bright bell, rung twice',
    periodMs: 2600,
    notes: [
      { at: 0, len: 1.0, freqs: [880, 1760, 2640], gain: 0.3 },
      { at: 1.2, len: 1.0, freqs: [880, 1760, 2640], gain: 0.3 },
    ],
  },
  {
    id: 'oldphone',
    name: 'Old telephone',
    description: 'The fast mechanical trill of a rotary phone',
    periodMs: 3000,
    notes: Array.from({ length: 20 }, (_, i) => ({ at: i * 0.1, len: 0.05, freqs: [i % 2 ? 1000 : 1250], gain: 0.35 })),
  },
];

export const DEFAULT_RINGTONE = RINGTONES[0]!.id;

export function ringtoneById(id: string | null | undefined): Ringtone {
  return RINGTONES.find((r) => r.id === id) ?? RINGTONES[0]!;
}

/** The tone chosen on this device. */
export function loadRingtone(): string {
  try {
    return ringtoneById(localStorage.getItem(KEY)).id;
  } catch {
    return DEFAULT_RINGTONE;
  }
}

export function saveRingtone(id: string): void {
  try {
    localStorage.setItem(KEY, ringtoneById(id).id);
  } catch {
    /* private mode: the choice holds for this visit */
  }
}

function play(tone: Ringtone) {
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    for (const n of tone.notes) {
      const gain = n.gain ?? RING_GAIN;
      for (const freq of n.freqs) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = n.wave ?? 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0 + n.at);
        g.gain.exponentialRampToValueAtTime(gain, t0 + n.at + 0.02);
        g.gain.setValueAtTime(gain, t0 + n.at + Math.max(0.03, n.len - 0.08));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0 + n.at);
        o.stop(t0 + n.at + n.len + 0.01);
      }
    }
  } catch {
    /* no audio permission yet: the card is still shown */
  }
}

/** Rings with the device's chosen tone (or the given one) until stopped or `maxMs`. */
export function startRingtone(maxMs = 30_000, id?: string) {
  stopRingtone();
  const tone = ringtoneById(id ?? loadRingtone());
  play(tone);
  loop = setInterval(() => play(tone), tone.periodMs);
  cap = setTimeout(stopRingtone, maxMs);
}

/** Plays one pass of a tone, for choosing. */
export function previewRingtone(id: string) {
  startRingtone(Math.min(ringtoneById(id).periodMs * 2, 6000), id);
}

export function stopRingtone() {
  if (loop) clearInterval(loop);
  if (cap) clearTimeout(cap);
  loop = null;
  cap = null;
}
