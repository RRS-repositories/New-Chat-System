/**
 * Every document in one place.
 *
 * The owner asked for "a document button where all documents sent is seen at a single
 * place" (13 Oct 2026). The channel details panel already lists one channel's files;
 * this is the same list without the channel boundary, so a file can be found when you
 * remember the name but not where it was posted.
 *
 * It shows only what the person is already allowed to see — the server returns files
 * from their own channels and nothing else. The channel each file came from is shown
 * so a result is traceable, except for direct messages, which say only "Direct
 * message": putting somebody's name on a list other people may read over your shoulder
 * is not worth the convenience.
 */
import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type { ChannelFileRow } from '../../types/index.ts';
import { useChat } from '../../context/chatContext.ts';

type Row = ChannelFileRow & { channelName?: string };

/** 1.2 MB rather than 1258291 bytes. */
function readableSize(bytes: number): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readableDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function DocumentsPanel({ onClose }: { onClose: () => void }) {
  const { actions } = useChat();
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  // Typing re-asks the server rather than filtering what is on screen: the answer
  // must come from every document the person has, not only the page already loaded.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const page = await actions.loadAllFiles(null, query);
        if (cancelled) return;
        setRows(page.files as Row[]);
        setCursor(page.nextCursor);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load the documents');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy(true);
    try {
      const page = await actions.loadAllFiles(cursor, query);
      setRows((prev) => [...prev, ...(page.files as Row[])]);
      setCursor(page.nextCursor);
    } catch (e: any) {
      setError(e?.message || 'Could not load more');
    } finally {
      setBusy(false);
    }
  }

  async function download(f: Row) {
    try {
      const url = await actions.fetchBlob(`/api/chat/files/${f.id}/download`);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.filename;
      a.click();
    } catch (e: any) {
      setError(e?.message || 'Could not download');
    }
  }

  return (
    <div className="sov" onClick={onClose}>
      <div className="sbox search-modal" role="dialog" aria-label="Documents" onClick={(e) => e.stopPropagation()}>
        <div className="srow">
          <FileText size={18} />
          <input
            ref={boxRef}
            value={query}
            placeholder="Search every document by name"
            aria-label="Search documents"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="skbd" aria-label="Close" onClick={onClose}>
            Esc
          </button>
        </div>

        {error && <p className="error pad">{error}</p>}

        <div className="docs-list">
          {rows.map((f) => (
            <button key={f.id} className="shit docs-row" onClick={() => void download(f)} title="Download">
              <FileText size={15} />
              <span className="docs-name">{f.filename}</span>
              <span className="docs-meta">
                {f.channelName || ''}
                {f.userName ? ` · ${f.userName}` : ''}
                {readableDate(f.createdAt) ? ` · ${readableDate(f.createdAt)}` : ''}
                {readableSize(f.sizeBytes) ? ` · ${readableSize(f.sizeBytes)}` : ''}
              </span>
            </button>
          ))}

          {!rows.length && !busy && (
            <p className="s-none">
              {query ? 'No document matches that name.' : 'No documents have been shared yet.'}
            </p>
          )}

          {cursor && (
            <button className="btn-ghost btn-small more" onClick={() => void loadMore()} disabled={busy}>
              {busy ? 'Loading…' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
