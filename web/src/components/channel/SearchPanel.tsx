import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import type { SearchHit } from '../../types/index.ts';
import { snippetParts } from '../../utils/snippet.ts';
import { formatTime } from '../../utils/format.ts';
import { generation, latestOnly } from '../../utils/latest.ts';
type Result = { hits: SearchHit[]; page: number; hasMore: boolean };
const EMPTY: Result = { hits: [], page: 1, hasMore: false };
export function SearchPanel({ currentChannelId, onJump, onClose }: { currentChannelId: string | null; onJump: (channelId: string, messageId: string) => void; onClose: () => void }) {
  const { actions } = useChat();
  const [q, setQ] = useState(''); const [here, setHere] = useState(false); const [hits, setHits] = useState<SearchHit[]>([]); const [page, setPage] = useState(1); const [more, setMore] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  // First-page requests (and clearing the box) go through one guard, so a slow
  // earlier response never overwrites a newer one. "More" has its own: every
  // new query bumps `gen`, and a pending More from an older query is dropped
  // instead of appending its page onto the new hits.
  const latest = useRef(latestOnly<Result>()).current;
  const gen = useRef(generation()).current;
  const [loadingMore, setLoadingMore] = useState(false);
  // The query the shown hits belong to: "More" pages that one, not whatever is
  // in the box during the debounce.
  const shown = useRef<{ q: string; channelId: string | null }>({ q: '', channelId: null });
  useEffect(() => {
    const t = setTimeout(async () => {
      gen.next(); setLoadingMore(false);
      const blank = !q.trim();
      if (!blank) { setBusy(true); setError(null); }
      const channelId = here ? currentChannelId : null;
      try {
        const r = await latest(blank ? Promise.resolve(EMPTY) : actions.search(q, channelId, 1));
        if (!r) return;
        shown.current = { q, channelId };
        setHits(r.hits); setPage(1); setMore(r.hasMore); setBusy(false);
      } catch (e: any) { setError(e?.message || 'Search failed'); setBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, here, currentChannelId, actions, latest, gen]);
  async function loadMore() {
    if (busy || loadingMore) return;
    const g = gen.current(); const next = page + 1; const { q: sq, channelId } = shown.current;
    setLoadingMore(true);
    try {
      const r = await actions.search(sq, channelId, next);
      if (!gen.isCurrent(g)) return;
      setHits((h) => [...h, ...r.hits]); setPage(next); setMore(r.hasMore);
    } catch (e: any) { if (gen.isCurrent(g)) setError(e?.message || 'Search failed'); }
    finally { if (gen.isCurrent(g)) setLoadingMore(false); }
  }
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal search-modal" role="dialog" aria-label="Search messages" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2><Search size={14} /> Search</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
        <label className="field"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" autoFocus /></label>
        {currentChannelId && <label className="row gap muted"><input type="checkbox" checked={here} onChange={(e) => setHere(e.target.checked)} /> This channel only</label>}
        {error && <p className="error">{error}</p>}
        <div className="pick-list">
          {hits.map((h) => (
            <button key={h.messageId} className="pick-row search-hit" onClick={() => { onJump(h.channelId, h.messageId); onClose(); }}>
              <div className="muted">{h.channelName} · {h.userName} · {formatTime(h.createdAt)}</div>
              <div>{snippetParts(h.snippet).map((p, i) => (p.hit ? <mark key={i} className="hit">{p.text}</mark> : <span key={i}>{p.text}</span>))}</div>
            </button>
          ))}
          {!hits.length && q.trim() && !busy && !error && <p className="muted pad">No results</p>}
        </div>
        {more && !busy && <button className="btn-ghost" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'More'}</button>}
      </div>
    </div>
  );
}
