import { useEffect, useRef, useState } from 'react';
import { Hash, Lock, Search, User, X } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import type { Channel, ChatUser, SearchHit } from '../../types/index.ts';
import { quickFind } from '../../utils/quickFind.ts';
import { snippetParts } from '../../utils/snippet.ts';
import { formatTime } from '../../utils/format.ts';
import { generation, latestOnly } from '../../utils/latest.ts';
type Result = { hits: SearchHit[]; page: number; hasMore: boolean };
const EMPTY: Result = { hits: [], page: 1, hasMore: false };
const channelLabel = (channel: Channel) => channel.displayName || channel.name;

/**
 * One box that finds three things: people (opens the conversation with them), channels (opens the
 * channel) and messages (jumps to the message). People and channels are matched in the browser from
 * what is already loaded; messages are searched on the server.
 */
export function SearchPanel({
  currentChannelId,
  onJump,
  onOpenChannel,
  onClose,
}: {
  currentChannelId: string | null;
  onJump: (channelId: string, messageId: string) => void;
  onOpenChannel: (channelId: string) => void;
  onClose: () => void;
}) {
  const { actions, state } = useChat();
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [opening, setOpening] = useState(false);
  const [q, setQ] = useState('');
  const [here, setHere] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    actions
      .listUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [actions]);
  // "This channel only" is about messages: people and channels are left out then.
  const people = here ? [] : quickFind(users, (u) => u.fullName, q);
  const channels = here
    ? []
    : quickFind(
        state.channels.filter((c) => c.type !== 'dm'),
        channelLabel,
        q,
      );
  async function openPerson(person: ChatUser) {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      const channel = await actions.openDm(person.id);
      onOpenChannel(channel.id);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not open conversation');
      setOpening(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(async () => {
      gen.next();
      setLoadingMore(false);
      const blank = !q.trim();
      if (!blank) {
        setBusy(true);
        setError(null);
      }
      const channelId = here ? currentChannelId : null;
      try {
        const r = await latest(blank ? Promise.resolve(EMPTY) : actions.search(q, channelId, 1));
        if (!r) return;
        shown.current = { q, channelId };
        setHits(r.hits);
        setPage(1);
        setMore(r.hasMore);
        setBusy(false);
      } catch (e: any) {
        setError(e?.message || 'Search failed');
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, here, currentChannelId, actions, latest, gen]);
  async function loadMore() {
    if (busy || loadingMore) return;
    const g = gen.current();
    const next = page + 1;
    const { q: sq, channelId } = shown.current;
    setLoadingMore(true);
    try {
      const r = await actions.search(sq, channelId, next);
      if (!gen.isCurrent(g)) return;
      setHits((h) => [...h, ...r.hits]);
      setPage(next);
      setMore(r.hasMore);
    } catch (e: any) {
      if (gen.isCurrent(g)) setError(e?.message || 'Search failed');
    } finally {
      if (gen.isCurrent(g)) setLoadingMore(false);
    }
  }
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal search-modal"
        role="dialog"
        aria-label="Search messages"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>
            <Search size={14} /> Search
          </h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <label className="field">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search messages, people and channels"
            aria-label="Search"
            data-testid="search-input"
            autoFocus
          />
        </label>
        {currentChannelId && (
          <label className="row gap muted">
            <input type="checkbox" checked={here} onChange={(e) => setHere(e.target.checked)} /> This channel only
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="pick-list search-results" data-testid="search-results">
          {people.length > 0 && <div className="search-section">People</div>}
          {people.map((person) => (
            <button
              key={`person-${person.id}`}
              className="pick-row"
              data-testid="search-person"
              disabled={opening}
              onClick={() => void openPerson(person)}
            >
              <User size={14} aria-hidden="true" />
              {person.fullName}
              <span className="muted"> · {person.role}</span>
            </button>
          ))}
          {channels.length > 0 && <div className="search-section">Channels</div>}
          {channels.map((channel) => (
            <button
              key={`channel-${channel.id}`}
              className="pick-row"
              data-testid="search-channel"
              onClick={() => {
                onOpenChannel(channel.id);
                onClose();
              }}
            >
              {channel.type === 'private' ? (
                <Lock size={14} aria-hidden="true" />
              ) : (
                <Hash size={14} aria-hidden="true" />
              )}
              {channelLabel(channel)}
            </button>
          ))}
          {hits.length > 0 && (people.length > 0 || channels.length > 0) && (
            <div className="search-section">Messages</div>
          )}
          {hits.map((h) => (
            <button
              key={h.messageId}
              className="pick-row search-hit"
              data-testid="search-hit"
              onClick={() => {
                onJump(h.channelId, h.messageId);
                onClose();
              }}
            >
              <div className="muted">
                {h.channelName} · {h.userName} · {formatTime(h.createdAt)}
              </div>
              <div>
                {snippetParts(h.snippet).map((p, i) =>
                  p.hit ? (
                    <mark key={i} className="hit">
                      {p.text}
                    </mark>
                  ) : (
                    <span key={i}>{p.text}</span>
                  ),
                )}
              </div>
            </button>
          ))}
          {!hits.length && !people.length && !channels.length && q.trim() && !busy && !error && (
            <p className="muted pad">No results</p>
          )}
        </div>
        {more && !busy && (
          <button className="btn-ghost" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'More'}
          </button>
        )}
      </div>
    </div>
  );
}
