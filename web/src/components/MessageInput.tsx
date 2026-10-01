import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Send, Paperclip, X } from 'lucide-react';
import type { Message } from '../api/types.ts';
import { ReplyingToBar } from './ReplyingToBar.tsx';
import { MentionAutocomplete } from './MentionAutocomplete.tsx';
import { mentionQueryAt, insertMention, mentionItems } from '../lib/mentions.ts';
import { ACCEPT, formatBytes, validateFiles } from '../lib/files.ts';

type Props = {
  onSend: (c: string) => Promise<void>; onTyping: () => void; disabled?: boolean;
  replyTo?: Message | null; onCancelReply?: () => void;
  members?: { id: number; fullName: string }[];
  onUpload?: (files: File[], content: string) => Promise<void>;
  /** false: Enter adds a new line and Ctrl/Cmd+Enter sends. */
  sendOnEnter?: boolean;
};
export type MessageInputHandle = { addFiles: (files: File[]) => void };

export const MessageInput = forwardRef<MessageInputHandle, Props>(function MessageInput({ onSend, onTyping, disabled, replyTo, onCancelReply, members = [], onUpload, sendOnEnter = true }, ref) {
  const [text, setText] = useState(''); const [caret, setCaret] = useState(0); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [mentionsOpen, setMentionsOpen] = useState(true); const [idx, setIdx] = useState(0); const [pending, setPending] = useState<File[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null); const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (replyTo) ta.current?.focus(); }, [replyTo]);
  const mq = mentionsOpen ? mentionQueryAt(text, caret) : null;
  const items = useMemo(() => (mq ? mentionItems(members, mq.query) : []), [members, mq?.query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setIdx(0), [mq?.query]);
  const listOpen = !!mq && items.length > 0;

  function addFiles(list: File[]) {
    if (!onUpload) return;
    const { ok, errors } = validateFiles([...pending, ...list]);
    setPending(ok); setError(errors.length ? errors.join('. ') : null);
  }
  useImperativeHandle(ref, () => ({ addFiles }), [pending, onUpload]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    const c = text.trim(); if (busy || (!c && !pending.length)) return; setBusy(true); setError(null);
    try {
      if (pending.length && onUpload) await onUpload(pending, c); else await onSend(c);
      setText(''); setCaret(0); setPending([]);
    } catch (e: any) { setError(e?.message || 'Could not send'); } finally { setBusy(false); }
  }
  function pick(name: string) {
    if (!mq) return;
    const r = insertMention(text, mq.start, caret, name);
    setText(r.text); setCaret(r.caret); setMentionsOpen(true);
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(r.caret, r.caret); });
  }
  // The list only takes keys while it has something to offer; otherwise Enter
  // sends as usual, so "@team" (no such person) never traps the composer.
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (listOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (i + 1) % items.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (i - 1 + items.length) % items.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[idx]!.label); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionsOpen(false); return; }
    }
    if (e.key === 'Enter' && (sendOnEnter ? !e.shiftKey : e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); }
    else if (e.key === 'Escape' && replyTo) onCancelReply?.();
    else onTyping();
  }
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length && onUpload) { e.preventDefault(); addFiles(files); }
  }
  const syncCaret = () => setCaret(ta.current?.selectionStart ?? text.length);
  const canSend = (text.trim() !== '' || pending.length > 0) && !busy && !disabled;
  return (
    <div className="input-bar">
      {replyTo && onCancelReply && <ReplyingToBar target={replyTo} onCancel={onCancelReply} />}
      {pending.length > 0 && (
        <div className="pending-files">{pending.map((f, i) => <span key={`${f.name}-${i}`} className="pending-file">{f.name} <span className="muted">{formatBytes(f.size)}</span><button className="icon-btn small" aria-label={`Remove ${f.name}`} onClick={() => setPending(pending.filter((_, j) => j !== i))}><X size={12} /></button></span>)}</div>
      )}
      {error && <p className="error">{error}</p>}
      {listOpen && <MentionAutocomplete items={items} idx={idx} onPick={pick} />}
      <div className="input-row">
        {onUpload && (
          <>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
            <button className="icon-btn" aria-label="Attach files" title="Attach" disabled={disabled} onClick={() => fileInput.current?.click()}><Paperclip size={18} /></button>
          </>
        )}
        <textarea ref={ta} value={text} rows={1} placeholder={pending.length ? 'Add a message (optional)' : 'Type a message'} disabled={disabled}
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setMentionsOpen(true); }}
          onKeyDown={onKey} onKeyUp={syncCaret} onClick={syncCaret} onSelect={syncCaret} onPaste={onPaste} onBlur={() => setMentionsOpen(false)} onFocus={() => setMentionsOpen(true)} />
        <button className="icon-btn send" aria-label="Send" disabled={!canSend} onClick={() => void submit()}><Send size={18} /></button>
      </div>
    </div>
  );
});
