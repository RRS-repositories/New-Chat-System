/**
 * Incoming-call ringtones: the classic two-tone ring made with WebAudio, and two recorded rings
 * (royalty-free, `web/public/sounds/`, normalised loud). One is chosen per device, from a dropdown
 * in Settings, with a volume (full by default). Rings until stopRingtone() or `maxMs` (the server
 * gives up ringing after 30 s).
 */
let ctx: AudioContext | null = null;
let loop: ReturnType<typeof setInterval> | null = null;
let cap: ReturnType<typeof setTimeout> | null = null;
let player: HTMLAudioElement | null = null;

const KEY = 'chat.ringtone';
const VOLUME_KEY = 'chat.ringVolume';
/** How loud the synthesised ring is at full volume: each of its two tones (they add to just under full scale). */
export const RING_GAIN = 0.45;
export const RING_PERIOD_MS = 2000;

export type Ringtone = { id: string; name: string; description: string; file?: string };

export const RINGTONES: Ringtone[] = [
  { id: 'classic', name: 'Classic phone', description: 'Two bursts of the traditional ring, every two seconds' },
  {
    id: 'phone-ringing',
    name: 'Phone ringing',
    description: 'A recorded modern telephone',
    file: '/sounds/phone-ringing.mp3',
  },
  {
    id: 'telephone-electronic',
    name: 'Electronic telephone',
    description: 'A recorded electronic office phone',
    file: '/sounds/telephone-electronic.mp3',
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

/** The ring volume as a fraction 0–1 (full by default); anything odd reads as full. */
export function clampVolume(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

export function loadRingVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    return raw === null ? 1 : clampVolume(raw);
  } catch {
    return 1;
  }
}

export function saveRingVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(clampVolume(v)));
  } catch {
    /* private mode */
  }
}

function playClassic(volume: number) {
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    const gain = Math.max(0.0002, RING_GAIN * volume);
    for (const [at, len] of [
      [0, 0.4],
      [0.6, 0.4],
    ] as const) {
      for (const freq of [400, 450]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(gain, t0 + at + 0.02);
        g.gain.setValueAtTime(gain, t0 + at + len - 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0 + at);
        o.stop(t0 + at + len + 0.01);
      }
    }
  } catch {
    /* no audio permission yet: the card is still shown */
  }
}

function playFile(file: string, volume: number) {
  try {
    player = new Audio(file);
    player.loop = true;
    player.volume = volume;
    void player.play().catch(() => {});
  } catch {
    /* no audio: the card is still shown */
  }
}

/** Rings with the device's chosen tone (or the given one) at the device's volume until stopped or `maxMs`. */
export function startRingtone(maxMs = 30_000, id?: string, volume?: number) {
  stopRingtone();
  const tone = ringtoneById(id ?? loadRingtone());
  const vol = clampVolume(volume ?? loadRingVolume());
  if (vol === 0) return;
  if (tone.file) playFile(tone.file, vol);
  else {
    playClassic(vol);
    loop = setInterval(() => playClassic(vol), RING_PERIOD_MS);
  }
  cap = setTimeout(stopRingtone, maxMs);
}

/** Plays a few seconds of a tone, for choosing. */
export function previewRingtone(id: string, volume?: number) {
  startRingtone(4000, id, volume);
}

export function stopRingtone() {
  if (loop) clearInterval(loop);
  if (cap) clearTimeout(cap);
  loop = null;
  cap = null;
  if (player) {
    try {
      player.pause();
      player.src = '';
    } catch {
      /* already gone */
    }
    player = null;
  }
}
