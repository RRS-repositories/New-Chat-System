/**
 * A voice note: the microphone recorded in the browser into one small sound file, then sent into
 * the conversation like any other file (so the card plays it in place for everyone).
 *
 * Nothing is recorded on the server. The sound exists only in this tab until it is sent.
 */
export type VoiceType = { mimeType: string; type: string; ext: string };
export type VoiceNote = { blob: Blob; type: string; ext: string; durationSecs: number; hitLimit: boolean };

/** Voice notes stop by themselves at ten minutes (about 2.5 MB at this bit rate). */
export const VOICE_MAX_SECS = 10 * 60;
const AUDIO_BITS = 32_000; // speech
const SLICE_MS = 1000;

/** What the browser can write, in order of preference, with the file type and ending the chat uses for it. */
const CANDIDATES: VoiceType[] = [
  { mimeType: 'audio/webm;codecs=opus', type: 'audio/webm', ext: 'webm' }, // Chrome, Edge, Firefox
  { mimeType: 'audio/webm', type: 'audio/webm', ext: 'webm' },
  { mimeType: 'audio/mp4', type: 'audio/mp4', ext: 'm4a' }, // Safari
  { mimeType: 'audio/ogg;codecs=opus', type: 'audio/ogg', ext: 'ogg' },
  { mimeType: 'audio/ogg', type: 'audio/ogg', ext: 'ogg' },
];
export function pickVoiceType(isSupported: (t: string) => boolean): VoiceType {
  return CANDIDATES.find((c) => isSupported(c.mimeType)) ?? { mimeType: '', type: 'audio/webm', ext: 'webm' };
}

const two = (n: number) => String(n).padStart(2, '0');
/** "Voice note 2026-11-02 10.15.webm" */
export function voiceNoteName(at: Date, ext: string): string {
  const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  return `Voice note ${day} ${two(at.getHours())}.${two(at.getMinutes())}.${ext}`;
}
/** 0:07, 1:30, 12:05 */
export const formatClock = (secs: number): string =>
  `${Math.floor(secs / 60)}:${two(Math.max(0, Math.floor(secs % 60)))}`;

export const canRecordVoice = (w: any = globalThis): boolean =>
  typeof w?.MediaRecorder === 'function' && typeof w?.navigator?.mediaDevices?.getUserMedia === 'function';

/** What a microphone problem means in words. */
export function microphoneProblem(e: any): string {
  const name = e?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone access was refused. Allow it in the browser’s site settings.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The microphone is in use by another app.';
  return e?.message || 'The microphone could not be used.';
}

/** The pieces of the browser that are used, so a test can stand them in. */
export type RecorderLike = {
  state: 'inactive' | 'recording' | 'paused';
  start(timesliceMs?: number): void;
  stop(): void;
  addEventListener(type: 'dataavailable' | 'stop' | 'error', fn: (e: any) => void): void;
};
export type StreamLike = { getTracks(): Array<{ stop(): void }> };
/** A sound level reader: 0 (silence) to 1 (loud). `close` releases what it holds. */
export type Meter = { level(): number; close(): void };

export type VoiceDeps = {
  getStream?: () => Promise<StreamLike>;
  makeRecorder?: (stream: StreamLike, opts: { mimeType?: string; audioBitsPerSecond: number }) => RecorderLike;
  isTypeSupported?: (t: string) => boolean;
  makeMeter?: (stream: StreamLike) => Meter | null;
  now?: () => number;
  maxSecs?: number;
  /** Called when the time ceiling stopped the recording (what there is, is kept). */
  onLimit?: () => void;
};

const defaultStream = async (): Promise<StreamLike> =>
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
const defaultRecorder: VoiceDeps['makeRecorder'] = (stream, opts) =>
  new MediaRecorder(stream as unknown as MediaStream, {
    ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
    audioBitsPerSecond: opts.audioBitsPerSecond,
  });
const defaultSupported = (t: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t);

/** A level reader on the Web Audio analyser. Null when the browser has no AudioContext. */
export function analyserMeter(stream: StreamLike): Meter | null {
  if (typeof AudioContext === 'undefined') return null;
  try {
    const context = new AudioContext();
    void context.resume().catch(() => {});
    const source = context.createMediaStreamSource(stream as unknown as MediaStream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    return {
      level() {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const v = ((samples[i] ?? 128) - 128) / 128;
          sum += v * v;
        }
        return Math.min(1, Math.sqrt(sum / samples.length) * 3);
      },
      close() {
        source.disconnect();
        void context.close().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}

export class VoiceRecorder {
  private stream: StreamLike | null = null;
  private recorder: RecorderLike | null = null;
  private meter: Meter | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private hitLimit = false;
  private cancelled = false;
  private done: Promise<VoiceNote | null> | null = null;
  private finish: ((note: VoiceNote | null) => void) | null = null;
  private kind: VoiceType;
  private readonly deps: Required<
    Pick<VoiceDeps, 'getStream' | 'makeRecorder' | 'isTypeSupported' | 'makeMeter' | 'now' | 'maxSecs'>
  > &
    Pick<VoiceDeps, 'onLimit'>;

  constructor(deps: VoiceDeps = {}) {
    this.deps = {
      getStream: deps.getStream ?? defaultStream,
      makeRecorder: deps.makeRecorder ?? defaultRecorder!,
      isTypeSupported: deps.isTypeSupported ?? defaultSupported,
      makeMeter: deps.makeMeter ?? analyserMeter,
      now: deps.now ?? Date.now,
      maxSecs: deps.maxSecs ?? VOICE_MAX_SECS,
      onLimit: deps.onLimit,
    };
    this.kind = pickVoiceType(this.deps.isTypeSupported);
  }

  get state(): 'idle' | 'recording' | 'done' {
    if (this.done && !this.recorder) return 'done';
    return this.recorder ? 'recording' : 'idle';
  }
  /** The file type this browser writes. */
  get voiceType(): VoiceType {
    return this.kind;
  }
  elapsedSecs(): number {
    return this.recorder ? Math.floor((this.deps.now() - this.startedAt) / 1000) : 0;
  }
  /** The sound level right now, 0 to 1 (0 when there is no meter). */
  level(): number {
    return this.meter?.level() ?? 0;
  }

  /** Asks for the microphone and starts. Throws a readable message when it cannot. */
  async start(): Promise<void> {
    if (this.recorder) throw new Error('Already recording');
    this.cancelled = false; // a cancel() from here on (while the permission prompt is up) counts
    let stream: StreamLike;
    try {
      stream = await this.deps.getStream();
    } catch (e) {
      throw new Error(microphoneProblem(e));
    }
    if (this.cancelled) {
      // Cancelled while the permission prompt was up: let the microphone go again at once.
      for (const t of stream.getTracks()) t.stop();
      this.cancelled = false;
      return;
    }
    let recorder: RecorderLike;
    try {
      recorder = this.deps.makeRecorder(stream, { mimeType: this.kind.mimeType, audioBitsPerSecond: AUDIO_BITS });
    } catch (e: any) {
      for (const t of stream.getTracks()) t.stop();
      throw new Error(e?.message || 'This browser cannot record sound.');
    }
    this.stream = stream;
    this.recorder = recorder;
    this.meter = this.deps.makeMeter(stream);
    this.chunks = [];
    this.hitLimit = false;
    this.startedAt = this.deps.now();
    this.done = new Promise<VoiceNote | null>((resolve) => {
      this.finish = resolve;
    });
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data?.size) this.chunks.push(e.data);
      if (this.recorder === recorder && recorder.state === 'recording' && this.elapsedSecs() >= this.deps.maxSecs) {
        this.hitLimit = true;
        recorder.stop();
        this.deps.onLimit?.();
      }
    });
    recorder.addEventListener('stop', () => {
      if (this.recorder !== recorder) return;
      const durationSecs = Math.max(1, Math.round((this.deps.now() - this.startedAt) / 1000));
      const note: VoiceNote | null = this.cancelled
        ? null
        : {
            blob: new Blob(this.chunks, { type: this.kind.type }),
            type: this.kind.type,
            ext: this.kind.ext,
            durationSecs,
            hitLimit: this.hitLimit,
          };
      this.release();
      this.finish?.(note);
    });
    recorder.addEventListener('error', () => {
      if (this.recorder !== recorder) return;
      this.release();
      this.finish?.(null);
    });
    recorder.start(SLICE_MS);
  }

  /**
   * Stops and hands back the note; after a stop (ours, or the ceiling's) it hands back the same note
   * again. Resolves to null when nothing was ever recorded or it was cancelled.
   */
  stop(): Promise<VoiceNote | null> {
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    return this.done ?? Promise.resolve(null);
  }

  /** Throws the recording away and lets the microphone go. */
  cancel(): void {
    this.cancelled = true;
    if (!this.recorder) return;
    void this.stop();
  }

  private release() {
    this.meter?.close();
    this.meter = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.recorder = null;
    this.cancelled = false;
  }
}
