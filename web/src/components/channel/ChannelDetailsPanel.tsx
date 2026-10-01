import { useEffect, useState } from 'react';
import { ArrowLeft, X, FileText } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import type { ChannelFileRow } from '../../types/index.ts';
import { formatBytes } from '../../utils/files.ts';
import { formatTime } from '../../utils/format.ts';
import { presenceOf } from '../../utils/presence.ts';
import { PresenceDot, StatusBadge } from '../common/PresenceDot.tsx';
export function ChannelDetailsPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const { state, actions } = useChat();
  const [tab, setTab] = useState<'members' | 'files'>('members');
  const [files, setFiles] = useState<ChannelFileRow[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const members = state.membersByChannel[channelId] || [];
  useEffect(() => { void actions.loadMembers(channelId).catch(() => {}); }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadFiles(more = false) {
    setLoading(true); setError(null);
    try { const r = await actions.loadChannelFiles(channelId, more ? cursor : null); setFiles(more ? [...files, ...r.files] : r.files); setCursor(r.nextCursor); }
    catch (e: any) { setError(e?.message || 'Could not load files'); } finally { setLoading(false); }
  }
  useEffect(() => { if (tab === 'files') void loadFiles(false); }, [tab, channelId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function download(f: ChannelFileRow) {
    try { const url = await actions.fetchBlob(`/api/chat/files/${f.id}/download`); const a = document.createElement('a'); a.href = url; a.download = f.filename; a.click(); }
    catch (e: any) { setError(e?.message || 'Could not download'); }
  }
  return (
    <aside className="thread-panel" aria-label="Channel details">
      <header className="chan-head">
        <button className="icon-btn only-mobile" aria-label="Back" onClick={onClose}><ArrowLeft size={18} /></button>
        <h2 className="chan-title">Details</h2>
        <button className="icon-btn only-desktop push-right" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="tabs"><button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members ({members.length})</button><button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Files</button></div>
      <div className="feed">
        {tab === 'members' && members.map((m) => <div key={m.id} className="pick-row"><PresenceDot state={presenceOf(state.presence, m.id)} /><span>{m.fullName}</span><StatusBadge status={state.presence.statuses[m.id]} withText /><span className="muted"> · {m.channelRole === 'owner' ? 'owner' : m.role}</span></div>)}
        {tab === 'files' && (
          <>
            {files.map((f) => <div key={f.id} className="pick-row file-row"><FileText size={16} /><button className="pin-body" onClick={() => void download(f)}><div className="file-name">{f.filename}</div><div className="muted">{formatBytes(f.sizeBytes)} · {f.userName}{f.createdAt ? ` · ${formatTime(f.createdAt)}` : ''}</div></button></div>)}
            {!files.length && !loading && <p className="muted pad">No files shared yet</p>}
            {error && <p className="error pad">{error}</p>}
            {cursor && <button className="btn-ghost" disabled={loading} onClick={() => void loadFiles(true)}>Load more</button>}
          </>
        )}
      </div>
    </aside>
  );
}
