/**
 * Speech to text through the browser's own recognition (Chrome, Edge and Safari have it; Firefox
 * does not). The browser sends the sound to its maker's speech service and hands words back; nothing
 * goes through the chat's server.
 *
 * The browser stops listening by itself after a silence or about a minute: while the person still
 * wants to dictate, listening is started again at once, up to a ceiling of ten minutes in one go.
 */
import { dictationProblem, heard } from '../utils/speechText.ts';

/** The part of the browser's SpeechRecognition that is used (it is not in the TypeScript DOM types). */
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((e: { resultIndex?: number; results: ArrayLike<any> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type Make = () => Recognition | null;

/** The browser's recognition class, under either of its names, or null when there is none. */
export function recognitionMaker(w: any = globalThis): Make | null {
  const Ctor = w?.SpeechRecognition || w?.webkitSpeechRecognition;
  return typeof Ctor === 'function' ? () => new Ctor() : null;
}
export const canDictate = (w: any = globalThis) => recognitionMaker(w) !== null;

export const DICTATION_MAX_MS = 10 * 60_000;
export const DICTATION_LANG = 'en-GB';

export type DictationHandlers = {
  /** Settled words to add (null when none this time), and the words still being guessed. */
  onText: (committed: string | null, interim: string) => void;
  onListening: (listening: boolean) => void;
  onProblem: (message: string) => void;
};

export class Dictation {
  private rec: Recognition | null = null;
  private wanted = false;
  private startedAt = 0;
  private restarts = 0;
  private readonly make: Make | null;
  private readonly on: DictationHandlers;
  private readonly now: () => number;

  constructor(
    on: DictationHandlers,
    { make = recognitionMaker(), now = Date.now }: { make?: Make | null; now?: () => number } = {},
  ) {
    this.on = on;
    this.make = make;
    this.now = now;
  }

  /** True from start() until the person stops it, it hits the ceiling, or a problem ends it. */
  get listening(): boolean {
    return this.wanted;
  }
  /** How many times listening was quietly started again. */
  get restarted(): number {
    return this.restarts;
  }

  start(lang = DICTATION_LANG): void {
    if (this.wanted) return;
    if (!this.make) return this.on.onProblem('Dictation is not available in this browser.');
    this.wanted = true;
    this.startedAt = this.now();
    this.restarts = 0;
    this.spin(lang);
  }

  stop(): void {
    const rec = this.rec;
    this.wanted = false;
    if (rec) rec.stop();
    else this.on.onListening(false);
  }

  private spin(lang: string) {
    const rec = this.make!();
    if (!rec) {
      this.wanted = false;
      return this.on.onProblem('Dictation is not available in this browser.');
    }
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => this.on.onListening(true);
    rec.onresult = (e) => {
      const { finals, interim } = heard(e.results, e.resultIndex ?? 0);
      this.on.onText(finals.length ? finals.join(' ') : null, interim);
    };
    rec.onerror = (e) => {
      const message = dictationProblem(e?.error);
      if (!message) return; // a silence, or our own stop: the browser ends and we carry on or finish
      this.wanted = false;
      this.on.onProblem(message);
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      this.on.onText(null, ''); // whatever was still being guessed is gone with the session
      if (this.wanted && this.now() - this.startedAt < DICTATION_MAX_MS) {
        this.restarts++;
        this.spin(lang);
        return;
      }
      this.wanted = false;
      this.on.onListening(false);
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (e: any) {
      this.rec = null;
      this.wanted = false;
      this.on.onProblem(e?.message || 'Dictation could not start.');
      this.on.onListening(false);
    }
  }
}
