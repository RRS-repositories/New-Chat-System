import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Message as M } from '../api/types.ts';
import { Message } from './Message.tsx';
import { groupWithPrevious } from '../lib/format.ts';

type Props = {
  items: M[]; hasOlder: boolean; onLoadOlder: () => Promise<void>; selfId: number; canModerate: boolean;
  windowed?: boolean; onLoadLatest?: () => Promise<void>;
  highlightId: string | null; onHighlightDone: () => void;
  renderContent?: (content: string) => ReactNode; renderExtra?: (m: M) => ReactNode;
  onEdit: (id: string, c: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onReply: (m: M) => void; onThread: (m: M) => void; onPin: (m: M) => void; onReact: (m: M, emoji: string) => void; onJump: (id: string) => void;
};

export function MessageFeed({ items, hasOlder, onLoadOlder, selfId, canModerate, windowed, onLoadLatest, highlightId, onHighlightDone, renderContent, renderExtra, onEdit, onDelete, onReply, onThread, onPin, onReact, onJump }: Props) {
  const box = useRef<HTMLDivElement>(null); const [pinned, setPinned] = useState(true); const [fresh, setFresh] = useState(false);
  const lastId = items.at(-1)?.id; const prevHeight = useRef(0); const loading = useRef(false);

  useLayoutEffect(() => { const el = box.current; if (!el) return; if (highlightId) return; if (pinned) el.scrollTop = el.scrollHeight; else if (prevHeight.current) { el.scrollTop += el.scrollHeight - prevHeight.current; prevHeight.current = 0; } }, [items.length, pinned, highlightId]);
  useEffect(() => { if (!pinned && lastId) setFresh(true); }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`msg-${highlightId}`);
    if (el) { setPinned(false); el.scrollIntoView({ block: 'center' }); }
    const t = setTimeout(onHighlightDone, 2000); return () => clearTimeout(t);
  }, [highlightId, items.length, onHighlightDone]);

  async function onScroll() {
    const el = box.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40; setPinned(atBottom); if (atBottom) setFresh(false);
    if (el.scrollTop < 80 && hasOlder && !loading.current) { loading.current = true; prevHeight.current = el.scrollHeight; try { await onLoadOlder(); } finally { loading.current = false; } }
  }
  if (!items.length) return <div className="feed"><p className="muted pad">No messages yet</p></div>;
  return (
    <div className="feed-wrap">
      <div className="feed" ref={box} onScroll={() => void onScroll()}>
        {hasOlder && <p className="muted center">Scroll up for older messages</p>}
        {items.map((m, i) => (
          <Message key={m.id} m={m} grouped={items[i - 1]?.type !== 'call' && groupWithPrevious(items[i - 1], m)} own={m.userId === selfId} canModerate={canModerate} highlighted={m.id === highlightId}
            renderContent={renderContent} extra={renderExtra?.(m)} onEdit={onEdit} onDelete={onDelete} onReply={onReply} onThread={onThread} onPin={onPin} onReact={onReact} onJump={onJump} />
        ))}
      </div>
      {windowed && onLoadLatest
        ? <button className="new-pill" onClick={() => { void onLoadLatest().then(() => { setPinned(true); setFresh(false); }); }}>Jump to latest <ChevronDown size={14} /></button>
        : fresh && !pinned && <button className="new-pill" onClick={() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; setPinned(true); setFresh(false); }}>New messages <ChevronDown size={14} /></button>}
    </div>
  );
}
