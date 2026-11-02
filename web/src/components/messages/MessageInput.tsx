import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { AudioLines, Mic, Paperclip, Send, Smile, X } from 'lucide-react';
import type { Message } from '../../types/index.ts';
import { ReplyingToBar } from './ReplyingToBar.tsx';
import { EmojiPicker } from './EmojiPicker.tsx';
import { MentionAutocomplete } from './MentionAutocomplete.tsx';
import { VoiceNoteBar } from './VoiceNoteBar.tsx';
import { mentionQueryAt, insertMention, mentionItems } from '../../utils/mentions.ts';
import { ACCEPT, formatBytes, validateFiles } from '../../utils/files.ts';
import { tableFromClipboard } from '../../utils/tablePaste.ts';
import { joinSpeech, spliceSpoken, spokenMarks, type Range } from '../../utils/speechText.ts';
import { Dictation, canDictate } from '../../services/dictation.ts';
import { canRecordVoice } from '../../services/voiceNote.ts';
import { useVoiceNote } from '../../hooks/useVoiceNote.ts';

type Props = {
  onSend: (c: string) => Promise<void>;
  onTyping: () => void;
  disabled?: boolean;
  /** When this changes (a conversation was opened) the cursor goes into the box, so typing can start at once. */
  focusKey?: string;
  replyTo?: Message | null;
  onCancelReply?: () => void;
  members?: { id: number; fullName: string }[];
  onUpload?: (files: File[], content: string) => Promise<void>;
  /** false: Enter adds a new line and Ctrl/Cmd+Enter sends. */
  sendOnEnter?: boolean;
  placeholder?: string;
  /** The formatting reminder under the box (left out in the narrow thread panel). */
  hint?: boolean;
};
export type MessageInputHandle = { addFiles: (files: File[]) => void };

export const MessageInput = forwardRef<MessageInputHandle, Props>(function MessageInput(
  {
    onSend,
    onTyping,
    disabled,
    focusKey,
    replyTo,
    onCancelReply,
    members = [],
    onUpload,
    sendOnEnter = true,
    placeholder = 'Message',
    hint = true,
  },
  ref,
) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mentionsOpen, setMentionsOpen] = useState(true);
  const [idx, setIdx] = useState(0);
  const [pending, setPending] = useState<File[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Dictation: the browser's speech recognition puts words where the cursor was when it started.
  // The dictated span is kept as a range, so the words follow whatever was typed before or after.
  const [dictating, setDictating] = useState(false);
  const dictation = useRef<Dictation | null>(null);
  const spoken = useRef<{ range: Range; committed: string }>({ range: { start: 0, end: 0 }, committed: '' });
  const dictationOn = useMemo(() => canDictate(), []);
  const voiceOn = useMemo(() => canRecordVoice(), []);
  function heardWords(committed: string | null, interim: string) {
    setText((prev) => {
      const state = spoken.current;
      const before = prev.slice(0, state.range.start);
      if (committed)
        state.committed = joinSpeech(before + state.committed, spokenMarks(committed)).slice(before.length);
      const shown = joinSpeech(before + state.committed, spokenMarks(interim)).slice(before.length);
      const next = spliceSpoken(prev, state.range, shown);
      state.range = next.range;
      return next.text;
    });
    const end = spoken.current.range.end;
    setCaret(end);
    requestAnimationFrame(() => ta.current?.setSelectionRange(end, end));
  }
  function toggleDictation() {
    if (dictating) return dictation.current?.stop();
    const at = ta.current?.selectionStart ?? text.length;
    spoken.current = { range: { start: at, end: at }, committed: '' };
    setError(null);
    dictation.current ??= new Dictation({
      onText: heardWords,
      onListening: setDictating,
      onProblem: (message) => {
        setError(message);
        setDictating(false);
      },
    });
    dictation.current.start();
    ta.current?.focus();
  }
  useEffect(() => () => dictation.current?.stop(), []);

  // A voice note goes out through the same upload as an attached file, with whatever is typed as its caption.
  const voice = useVoiceNote({
    onSend: async (file) => {
      if (!onUpload) throw new Error('Files cannot be sent here');
      await onUpload([file], text.trim());
      setText('');
      setCaret(0);
    },
  });
  function startVoiceNote() {
    if (dictating) dictation.current?.stop();
    setError(null);
    void voice.start();
  }

  // Opening a conversation puts the cursor in the box (the owner's rule, 12 Oct 2026). Not on a
  // phone or tablet, where that would throw the keyboard up over the messages.
  useEffect(() => {
    if (!focusKey) return;
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (!touch) ta.current?.focus();
  }, [focusKey]);
  useEffect(() => {
    if (replyTo) ta.current?.focus();
  }, [replyTo]);
  const mq = mentionsOpen ? mentionQueryAt(text, caret) : null;
  const items = useMemo(() => (mq ? mentionItems(members, mq.query) : []), [members, mq?.query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setIdx(0), [mq?.query]);
  const listOpen = !!mq && items.length > 0;

  function addFiles(list: File[]) {
    if (!onUpload) return;
    const { ok, errors } = validateFiles([...pending, ...list]);
    setPending(ok);
    setError(errors.length ? errors.join('. ') : null);
  }
  useImperativeHandle(ref, () => ({ addFiles }), [pending, onUpload]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    const c = text.trim();
    if (busy || (!c && !pending.length)) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.length && onUpload) await onUpload(pending, c);
      else await onSend(c);
      setText('');
      setCaret(0);
      setPending([]);
    } catch (e: any) {
      setError(e?.message || 'Could not send');
    } finally {
      setBusy(false);
    }
  }
  function pick(name: string) {
    if (!mq) return;
    const r = insertMention(text, mq.start, caret, name);
    setText(r.text);
    setCaret(r.caret);
    setMentionsOpen(true);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(r.caret, r.caret);
    });
  }
  // The list only takes keys while it has something to offer; otherwise Enter
  // sends as usual, so "@team" (no such person) never traps the composer.
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (listOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(items[idx]!.label);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionsOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && (sendOnEnter ? !e.shiftKey : e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && replyTo) onCancelReply?.();
    else onTyping();
  }
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length && onUpload) {
      e.preventDefault();
      addFiles(files);
      return;
    }
    // A table from a spreadsheet or a web page lands as a Markdown table (drawn as a table when sent).
    const table = tableFromClipboard({
      html: e.clipboardData?.getData('text/html'),
      text: e.clipboardData?.getData('text/plain'),
    });
    if (table) {
      e.preventDefault();
      insertAtCaret(text.trim() ? `\n${table}\n` : `${table}\n`);
    }
  }
  /** Puts text where the cursor is (replacing any selection). */
  function insertAtCaret(piece: string) {
    const at = ta.current?.selectionStart ?? text.length;
    const to = ta.current?.selectionEnd ?? at;
    setText(text.slice(0, at) + piece + text.slice(to));
    const after = at + piece.length;
    setCaret(after);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(after, after);
    });
  }
  /** Puts an emoji where the cursor is. */
  function insertEmoji(emoji: string) {
    const at = ta.current?.selectionStart ?? text.length;
    const next = text.slice(0, at) + emoji + text.slice(at);
    setText(next);
    const after = at + emoji.length;
    setCaret(after);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(after, after);
    });
  }
  const syncCaret = () => setCaret(ta.current?.selectionStart ?? text.length);
  const canSend = (text.trim() !== '' || pending.length > 0) && !busy && !disabled;
  return (
    <div className="comp input-bar">
      {replyTo && onCancelReply && <ReplyingToBar target={replyTo} onCancel={onCancelReply} />}
      {pending.length > 0 && (
        <div className="pending-files">
          {pending.map((f, i) => (
            <span key={`${f.name}-${i}`} className="pending-file">
              {f.name} <span className="muted">{formatBytes(f.size)}</span>
              <button
                className="icon-btn small"
                aria-label={`Remove ${f.name}`}
                onClick={() => setPending(pending.filter((_, j) => j !== i))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {(error || voice.error) && <p className="error">{error || voice.error}</p>}
      {listOpen && <MentionAutocomplete items={items} idx={idx} onPick={pick} />}
      {voice.phase !== 'idle' ? (
        <VoiceNoteBar voice={voice} />
      ) : (
        <div className="comp-in input-row">
          {onUpload && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT}
                hidden
                onChange={(e) => {
                  addFiles(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
              />
              <button
                className="cbtn"
                aria-label="Attach files"
                title="Attach"
                disabled={disabled}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip size={18} />
              </button>
            </>
          )}
          <textarea
            ref={ta}
            value={text}
            rows={1}
            placeholder={dictating ? 'Listening…' : pending.length ? 'Add a message (optional)' : placeholder}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setMentionsOpen(true);
            }}
            onKeyDown={onKey}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onSelect={syncCaret}
            onPaste={onPaste}
            onBlur={() => setMentionsOpen(false)}
            onFocus={() => setMentionsOpen(true)}
          />
          <button
            className={`cbtn dictate${dictating ? ' live' : ''}`}
            aria-label={dictating ? 'Stop dictating' : 'Dictate'}
            aria-pressed={dictating}
            title={
              dictationOn
                ? dictating
                  ? 'Stop dictating'
                  : 'Dictate: speak and the words go into the box'
                : 'Dictation is not available in this browser'
            }
            data-testid="dictate"
            disabled={disabled || !dictationOn}
            onClick={toggleDictation}
          >
            <Mic size={18} />
          </button>
          {onUpload && (
            <button
              className="cbtn"
              aria-label="Record a voice note"
              title={voiceOn ? 'Record a voice note' : 'Voice notes are not available in this browser'}
              data-testid="voice-start"
              disabled={disabled || !voiceOn}
              onClick={startVoiceNote}
            >
              <AudioLines size={18} />
            </button>
          )}
          <button
            ref={emojiButton}
            className="cbtn"
            aria-label="Emoji"
            title="Emoji"
            disabled={disabled}
            onClick={() => setEmojiOpen(!emojiOpen)}
          >
            <Smile size={18} />
          </button>
          {emojiOpen && (
            <EmojiPicker anchor={emojiButton} verb="Insert" onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
          )}
          <button className="sendb send" aria-label="Send" disabled={!canSend} onClick={() => void submit()}>
            <Send size={17} />
          </button>
        </div>
      )}
      {hint && (
        <p className="input-hint" aria-hidden="true">
          **bold** · `code` · - list · links become clickable · Shift+Enter for a new line
        </p>
      )}
    </div>
  );
});
