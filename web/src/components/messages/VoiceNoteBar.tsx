import { useEffect, useRef } from 'react';
import { Send, Square, Trash2 } from 'lucide-react';
import type { VoiceNoteControl } from '../../hooks/useVoiceNote.ts';
import { formatClock, VOICE_MAX_SECS } from '../../services/voiceNote.ts';

const BARS = 9;

/**
 * The composer while a voice note is being made: a red dot and clock with live sound bars, then
 * (after Stop) the note to listen back to. Discard and Send sit at the ends, where Attach and Send
 * usually are. Escape discards.
 */
export function VoiceNoteBar({ voice }: { voice: VoiceNoteControl }) {
  const bars = useRef<HTMLSpanElement>(null);
  const live = voice.phase === 'recording' || voice.phase === 'asking';
  const recording = voice.phase === 'recording';

  // The bars follow the microphone level a few times a frame; drawn straight onto the elements, not through state.
  useEffect(() => {
    if (!recording) return;
    let frame = 0;
    const smooth = new Array<number>(BARS).fill(0.1);
    const draw = () => {
      const level = voice.level();
      const nodes = bars.current?.children;
      if (nodes) {
        for (let i = 0; i < nodes.length; i++) {
          // The middle bars move most; each eases towards the level so the picture does not flicker.
          const centre = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS + 1) / 2);
          const want = Math.max(0.12, Math.min(1, level * (0.6 + centre) + Math.random() * 0.05 * level));
          smooth[i] = (smooth[i] ?? 0.1) + (want - (smooth[i] ?? 0.1)) * 0.35;
          (nodes[i] as HTMLElement).style.transform = `scaleY(${smooth[i]!.toFixed(3)})`;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [recording, voice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        voice.discard();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voice]);

  const busy = voice.phase === 'asking' || voice.phase === 'sending';
  return (
    <div className={`comp-in voice-row ${voice.phase}`} data-testid="voice-bar" role="group" aria-label="Voice note">
      <button
        className="cbtn"
        aria-label="Discard voice note"
        title="Discard"
        data-testid="voice-discard"
        disabled={voice.phase === 'sending'}
        onClick={() => voice.discard()}
      >
        <Trash2 size={18} />
      </button>
      {live ? (
        <>
          <span className={`voice-dot${recording ? ' on' : ''}`} aria-hidden="true" />
          <span className="voice-time" data-testid="voice-time" aria-live="off">
            {formatClock(voice.secs)}
          </span>
          <span className="voice-bars" ref={bars} aria-hidden="true">
            {Array.from({ length: BARS }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          <span className="voice-hint">
            {recording ? `Recording… up to ${formatClock(VOICE_MAX_SECS)}` : 'Waiting for the microphone…'}
          </span>
          <button
            className="cbtn"
            aria-label="Stop and listen back"
            title="Stop"
            data-testid="voice-stop"
            disabled={!recording}
            onClick={() => void voice.stop()}
          >
            <Square size={16} />
          </button>
        </>
      ) : (
        <>
          {voice.previewUrl && (
            <audio
              className="voice-preview"
              src={voice.previewUrl}
              controls
              preload="metadata"
              data-testid="voice-preview"
            />
          )}
          <span className="voice-time" data-testid="voice-time">
            {formatClock(voice.note?.durationSecs ?? 0)}
          </span>
          {voice.hitLimit && <span className="voice-hint">Stopped at the {formatClock(VOICE_MAX_SECS)} limit</span>}
        </>
      )}
      <button
        className="sendb send"
        aria-label="Send voice note"
        title="Send"
        data-testid="voice-send"
        disabled={busy}
        onClick={() => void voice.send()}
      >
        <Send size={17} />
      </button>
    </div>
  );
}
