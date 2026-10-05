/**
 * Records a call in the host's browser: everyone's voice mixed into one track (plus the shared
 * screen, if one is being shared when recording starts), written as a WebM file.
 *
 * Nothing is recorded on the server. The file exists only in this tab until it is saved into the
 * conversation, so closing the tab mid-recording loses it.
 */
export type Recording = { blob: Blob; durationSecs: number; hitLimit: boolean };

type Deps = {
  /** Stop by itself before the file grows past this (the upload limit). */
  maxBytes: number;
  /** Called when the size limit stopped the recording. */
  onLimit?: () => void;
  now?: () => number;
};

const AUDIO_BITS = 32_000; // speech
const VIDEO_BITS = 250_000; // a shared screen: mostly still
const SLICE_MS = 1000;

export const canRecord = () =>
  typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined' && typeof MediaStream !== 'undefined';

const pickType = (withVideo: boolean) => {
  const wanted = withVideo
    ? ['video/webm;codecs=vp8,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'video/webm'];
  return wanted.find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

export class CallRecorder {
  private context: AudioContext | null = null;
  private mix: MediaStreamAudioDestinationNode | null = null;
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private startedAt = 0;
  private hitLimit = false;
  private done: Promise<Recording> | null = null;
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Starts recording these voices (and this picture, if given). Throws when the browser cannot. */
  start(audioTracks: MediaStreamTrack[], videoTrack: MediaStreamTrack | null = null): void {
    if (this.recorder) throw new Error('Already recording');
    if (!canRecord()) throw new Error('This browser cannot record calls');
    const now = this.deps.now ?? Date.now;
    this.context = new AudioContext();
    void this.context.resume().catch(() => {});
    this.mix = this.context.createMediaStreamDestination();
    this.setAudioTracks(audioTracks);
    const picture = videoTrack && videoTrack.readyState === 'live' ? videoTrack : null;
    const stream = new MediaStream([...this.mix.stream.getAudioTracks(), ...(picture ? [picture] : [])]);
    const mimeType = pickType(!!picture);
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: AUDIO_BITS,
      ...(picture ? { videoBitsPerSecond: VIDEO_BITS } : {}),
    });
    this.recorder = recorder;
    this.chunks = [];
    this.bytes = 0;
    this.hitLimit = false;
    this.startedAt = now();
    this.done = new Promise<Recording>((resolve) => {
      recorder.addEventListener('stop', () => {
        const durationSecs = Math.max(1, Math.round((now() - this.startedAt) / 1000));
        // Always labelled video/webm: that is the WebM type the chat accepts and plays (sound-only files included).
        resolve({ blob: new Blob(this.chunks, { type: 'video/webm' }), durationSecs, hitLimit: this.hitLimit });
        this.release();
      });
    });
    recorder.addEventListener('dataavailable', (e) => {
      if (!e.data?.size) return;
      this.chunks.push(e.data);
      this.bytes += e.data.size;
      if (this.bytes >= this.deps.maxBytes * 0.94 && recorder.state === 'recording') {
        this.hitLimit = true;
        recorder.stop();
        this.deps.onLimit?.();
      }
    });
    recorder.start(SLICE_MS);
  }

  /** Keeps the mix in step with who is in the call: new voices are added, voices that left are dropped. */
  setAudioTracks(tracks: MediaStreamTrack[]): void {
    const context = this.context;
    const mix = this.mix;
    if (!context || !mix) return;
    const wanted = new Map(tracks.filter((t) => t && t.readyState === 'live').map((t) => [t.id, t]));
    for (const [id, source] of this.sources) {
      if (wanted.has(id)) continue;
      source.disconnect();
      this.sources.delete(id);
    }
    for (const [id, track] of wanted) {
      if (this.sources.has(id)) continue;
      const source = context.createMediaStreamSource(new MediaStream([track]));
      source.connect(mix);
      this.sources.set(id, source);
    }
  }

  /** Stops and hands back the file. Safe to call when nothing is being recorded (resolves to null). */
  stop(): Promise<Recording | null> {
    const recorder = this.recorder;
    const done = this.done;
    if (!recorder || !done) return Promise.resolve(null);
    if (recorder.state !== 'inactive') recorder.stop();
    return done;
  }

  private release() {
    for (const source of this.sources.values()) source.disconnect();
    this.sources.clear();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.mix = null;
    this.recorder = null;
    this.done = null;
  }
}
