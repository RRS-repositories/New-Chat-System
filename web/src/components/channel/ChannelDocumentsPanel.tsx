/**
 * The documents shared in one conversation.
 *
 * The owner, 13 Oct 2026: "in every channel/DM keep a search (any earlier message) and
 * document (the document should not be searchable - just list of documents simple)." So
 * this is a plain list, newest first, and nothing else: no search box, no filters. Pressing
 * a row downloads the file.
 *
 * It sits beside the conversation the way Pinned does, and shows only the files of the
 * channel being looked at — the server refuses a channel the person is not a member of.
 * The same rows exist under Details → Files; this gives them a button of their own, which
 * is what was asked for.
 */
import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import type { ChannelFileRow } from '../../types/index.ts';
import { useChat } from '../../context/chatContext.ts';
import { formatBytes } from '../../utils/files.ts';
import { formatTime, shortName } from '../../utils/format.ts';

type Props = {
  channelId: string;
  onClose: () => void;
};

/** The files of one conversation, newest first. */
export function ChannelDocumentsPanel({ channelId, onClose }: Props) {
  const { state, actions } = useChat();
  const [files, setFiles] = useState<ChannelFileRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channel = state.channels.find((c) => c.id === channelId);
  const where = channel ? (channel.type === 'dm' ? channel.dmUserName || '' : `#${channel.displayName}`) : '';

  async function load(more = false) {
    setLoading(true);
    setError(null);
    try {
      const page = await actions.loadChannelFiles(channelId, more ? cursor : null);
      setFiles((prev) => (more ? [...prev, ...page.files] : page.files));
      setCursor(page.nextCursor);
    } catch (e: any) {
      setError(e?.message || 'Could not load the documents');
    } finally {
      setLoading(false);
    }
  }

  // Switching conversation starts again rather than leaving the last one's files on screen.
  useEffect(() => {
    setFiles([]);
    setCursor(null);
    void load(false);
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function download(f: ChannelFileRow) {
    try {
      const url = await actions.fetchBlob(`/api/chat/files/${f.id}/download`);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.filename;
      a.click();
    } catch (e: any) {
      setError(e?.message || 'Could not download that file');
    }
  }

  return (
    <aside className="thread-panel" aria-label="Documents">
      <header className="p-h">
        <h2>Documents</h2>
        <span className="sub">{where}</span>
        <button className="p-x" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="p-b">
        {files.map((f) => (
          <div key={f.id} className="pinrow file-row" data-testid="document-row">
            <span className="hashic md" aria-hidden="true">
              <FileText size={14} />
            </span>
            <button className="bd pin-body" onClick={() => void download(f)} title="Download">
              <b className="file-name">{f.filename}</b>
              <p className="muted">
                {formatBytes(f.sizeBytes)} · {shortName(f.userName)}
                {f.createdAt ? ` · ${formatTime(f.createdAt)}` : ''}
              </p>
            </button>
          </div>
        ))}
        {!files.length && !loading && (
          <div className="p-empty">
            <FileText size={28} />
            No documents here yet.
            <br />
            Anything sent in this conversation shows up here.
          </div>
        )}
        {error && <p className="error pad">{error}</p>}
        {cursor && (
          <p className="center pad">
            <button className="btn-ghost btn-small" disabled={loading} onClick={() => void load(true)}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </p>
        )}
      </div>
    </aside>
  );
}
