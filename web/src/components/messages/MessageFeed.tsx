import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Message as M } from '../../types/index.ts';
import { Message } from './Message.tsx';
import { dayKey, dayLabel, groupWithPrevious } from '../../utils/format.ts';
import { firstNewMessageId } from '../../utils/firstNew.ts';
import { MAX_HELD } from '../../utils/messageWindow.ts';

type Props = {
  /** The part of the channel held on the page, oldest first (at most a few hundred messages). */
  items: M[];
  hasOlder: boolean;
  onLoadOlder: () => Promise<void>;
  /** Newer messages exist that are not on the page: the person is looking at older history. */
  windowed?: boolean;
  onLoadNewer?: () => Promise<void>;
  onLoadLatest?: () => Promise<void>;
  /** At the newest end with more than the cap on the page: let go of the oldest. */
  onTrim?: () => void;
  /** How many messages were unread when the channel was opened: the NEW line goes above the first of them. */
  unreadAtOpen?: number;
  /** Shown when the conversation has no messages yet. */
  empty?: ReactNode;
  selfId: number;
  canModerate: boolean;
  highlightId: string | null;
  onHighlightDone: () => void;
  renderContent?: (content: string) => ReactNode;
  renderExtra?: (m: M) => ReactNode;
  onEdit: (id: string, c: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReply: (m: M) => void;
  onThread: (m: M) => void;
  onPin: (m: M) => void;
  onReact: (m: M, emoji: string) => void;
  onJump: (id: string) => void;
};

const NEAR_EDGE_PX = 80;
const AT_BOTTOM_PX = 40;
/** How far past the cap the newest end may grow before the oldest are let go. */
const TRIM_SLACK = 100;

/** Where one message is on screen, so the view can be put back after messages are added or removed around it. */
type Mark = { id: string; top: number };

/** The first message on screen that will still be there after the list changes. Read before the page is redrawn. */
function markVisible(box: HTMLDivElement | null, staying: M[]): Mark | null {
  if (!box) return null;
  const kept = new Set(staying.map((m) => `msg-${m.id}`));
  const edge = box.getBoundingClientRect().top;
  for (const el of box.querySelectorAll<HTMLElement>('[id^="msg-"]')) {
    if (!kept.has(el.id)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > edge) return { id: el.id, top: rect.top };
  }
  return null;
}

/**
 * The messages of one channel. Only a window of a long channel is on the page: scrolling near the
 * top asks for older messages, scrolling near the bottom of a window asks for newer ones, and what
 * was read stays exactly where it was on screen while pages come and go.
 */
export const MessageFeed = memo(function MessageFeed({
  items,
  hasOlder,
  onLoadOlder,
  windowed = false,
  onLoadNewer,
  onLoadLatest,
  onTrim,
  unreadAtOpen = 0,
  empty,
  selfId,
  canModerate,
  highlightId,
  onHighlightDone,
  renderContent,
  renderExtra,
  onEdit,
  onDelete,
  onReply,
  onThread,
  onPin,
  onReact,
  onJump,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [fresh, setFresh] = useState(false);
  const lastId = items.at(-1)?.id;
  const loading = useRef(false);
  // Following the newest message only makes sense when the newest message is on the page.
  const pinned = atBottom && !windowed;

  // The NEW line is worked out once, when the channel's messages and its unread count are both known,
  // and then stays put while the person reads (it does not chase messages that arrive afterwards).
  const [newFromId, setNewFromId] = useState<string | null>(null);
  const newDecided = useRef(false);
  useEffect(() => {
    if (newDecided.current || !items.length || unreadAtOpen <= 0) return;
    newDecided.current = true;
    setNewFromId(firstNewMessageId(items, selfId, unreadAtOpen));
  }, [items, selfId, unreadAtOpen]);

  // The list is about to change and the page still shows the old one: note where a surviving message is.
  const shown = useRef(items);
  const mark = useRef<Mark | null>(null);
  if (shown.current !== items) {
    mark.current = pinned ? null : markVisible(box.current, items);
    shown.current = items;
  }

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || highlightId) return;
    if (pinned) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const was = mark.current;
    mark.current = null;
    const now = was && document.getElementById(was.id);
    if (was && now) el.scrollTop += now.getBoundingClientRect().top - was.top;
  }, [items, pinned, highlightId, newFromId]);

  useEffect(() => {
    if (!pinned && lastId && !windowed) setFresh(true);
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps

  // At the newest end the page would otherwise grow for as long as it stays open.
  useEffect(() => {
    if (pinned && items.length > MAX_HELD + TRIM_SLACK) onTrim?.();
  }, [items.length, pinned, onTrim]);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`msg-${highlightId}`);
    if (el) {
      setAtBottom(false);
      el.scrollIntoView({ block: 'center' });
    }
    const t = setTimeout(onHighlightDone, 2000);
    return () => clearTimeout(t);
  }, [highlightId, items.length, onHighlightDone]);

  async function loadOnce(load: () => Promise<void>) {
    loading.current = true;
    try {
      await load();
    } finally {
      loading.current = false;
    }
  }

  async function onScroll() {
    const el = box.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = fromBottom < AT_BOTTOM_PX;
    setAtBottom(bottom);
    if (bottom && !windowed) setFresh(false);
    if (loading.current) return;
    if (el.scrollTop < NEAR_EDGE_PX && hasOlder) await loadOnce(onLoadOlder);
    else if (fromBottom < NEAR_EDGE_PX && windowed && onLoadNewer) await loadOnce(onLoadNewer);
  }

  if (!items.length) return <div className="feed">{empty ?? <p className="muted pad">No messages yet</p>}</div>;

  let previousDay = '';
  return (
    <div className="feed-wrap">
      <div className="feed" ref={box} role="log" aria-label="Messages" onScroll={() => void onScroll()}>
        {hasOlder && <p className="feed-edge">Scroll up for older messages</p>}
        {items.map((m, i) => {
          const day = dayKey(m.createdAt);
          const newDay = day !== previousDay;
          previousDay = day;
          const isNew = m.id === newFromId;
          const previous = items[i - 1];
          // A day chip or the NEW line breaks a run of messages: the next one shows its author again.
          const grouped =
            !newDay &&
            !isNew &&
            previous?.type === m.type &&
            previous?.type !== 'call' &&
            groupWithPrevious(previous, m);
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="day">
                  <span>{dayLabel(m.createdAt)}</span>
                </div>
              )}
              {isNew && (
                <div className="newdiv" data-testid="new-divider">
                  NEW
                </div>
              )}
              <Message
                m={m}
                grouped={grouped}
                own={m.userId === selfId}
                canModerate={canModerate}
                highlighted={m.id === highlightId}
                renderContent={renderContent}
                renderExtra={renderExtra}
                onEdit={onEdit}
                onDelete={onDelete}
                onReply={onReply}
                onThread={onThread}
                onPin={onPin}
                onReact={onReact}
                onJump={onJump}
              />
            </Fragment>
          );
        })}
        {windowed && <p className="feed-edge">Scroll down for newer messages</p>}
      </div>
      {windowed && onLoadLatest ? (
        <button
          className="new-pill"
          onClick={() => {
            void onLoadLatest().then(() => {
              setAtBottom(true);
              setFresh(false);
            });
          }}
        >
          Jump to latest <ChevronDown size={14} />
        </button>
      ) : (
        fresh &&
        !pinned && (
          <button
            className="new-pill"
            onClick={() => {
              const el = box.current;
              if (el) el.scrollTop = el.scrollHeight;
              setAtBottom(true);
              setFresh(false);
            }}
          >
            New messages <ChevronDown size={14} />
          </button>
        )
      )}
    </div>
  );
});
