import { useEffect, useState } from 'react';
import { FileText, UserPlus, X } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import type { ChannelFileRow } from '../../types/index.ts';
import { formatBytes } from '../../utils/files.ts';
import { formatTime } from '../../utils/format.ts';
import { presenceOf, type PresenceState } from '../../utils/presence.ts';
import { StatusBadge } from '../common/PresenceDot.tsx';
import { UserAvatar } from '../common/UserAvatar.tsx';
import { PersonButton } from '../common/ProfileCard.tsx';
import { AddMembersDialog } from '../dialogs/AddMembersDialog.tsx';
import { ChannelOptions } from './ChannelOptions.tsx';
import { useCanModerate } from './MessagePanel.tsx';

type Props = {
  channelId: string;
  onClose: () => void;
  /** The channel left this person's list (they left it, or it was archived). */
  onGone: () => void;
};

const PRESENCE_LABEL: Record<PresenceState, string> = { online: 'Online', away: 'Away', offline: 'Offline' };

/** The right-hand panel about a conversation: who is in it, the files shared in it, and its options. */
export function ChannelDetailsPanel({ channelId, onClose, onGone }: Props) {
  const { state, user, actions } = useChat();
  const [tab, setTab] = useState<'members' | 'files' | 'options'>('members');
  const [adding, setAdding] = useState(false);
  const channel = state.channels.find((c) => c.id === channelId);
  const canManage = useCanModerate(channelId);
  const isDm = channel?.type === 'dm';
  const hasOptions = !!channel && !isDm;
  const [files, setFiles] = useState<ChannelFileRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = state.membersByChannel[channelId] || [];
  useEffect(() => {
    void actions.loadMembers(channelId).catch(() => {});
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadFiles(more = false) {
    setLoading(true);
    setError(null);
    try {
      const r = await actions.loadChannelFiles(channelId, more ? cursor : null);
      setFiles(more ? [...files, ...r.files] : r.files);
      setCursor(r.nextCursor);
    } catch (e: any) {
      setError(e?.message || 'Could not load files');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (tab === 'files') void loadFiles(false);
  }, [tab, channelId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function download(f: ChannelFileRow) {
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
  const dmPresence = isDm ? presenceOf(state.presence, channel!.dmUserId) : 'offline';
  const dmStatus = isDm && channel!.dmUserId != null ? state.presence.statuses[channel!.dmUserId] : undefined;
  return (
    <aside className="thread-panel" aria-label="Channel details">
      <header className="p-h">
        <h2>Details</h2>
        <button className="p-x" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="tabs">
        <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>
          {isDm ? 'About' : `Members (${members.length})`}
        </button>
        <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
          Files
        </button>
        {hasOptions && (
          <button
            className={tab === 'options' ? 'active' : ''}
            data-testid="channel-options-tab"
            onClick={() => setTab('options')}
          >
            Options
          </button>
        )}
      </div>
      <div className="p-b">
        {tab === 'members' && (
          <>
            {isDm && (
              <div className="prof-card">
                <UserAvatar userId={channel!.dmUserId} name={channel!.dmUserName || '?'} size="xl" />
                <b>{channel!.dmUserName}</b>
                <span className="st2">
                  {[dmStatus?.emoji, dmStatus?.text].filter(Boolean).join(' ') || PRESENCE_LABEL[dmPresence]}
                </span>
              </div>
            )}
            {channel && !isDm && (
              <>
                <div className="inf-sec">About</div>
                <div className="inf-topic">{channel.purpose || 'No purpose set'}</div>
              </>
            )}
            <div className="inf-sec">Members — {members.length}</div>
            {channel && !isDm && (
              <button className="mrow pick-row add-member" data-testid="add-members" onClick={() => setAdding(true)}>
                <span className="uav md add-ic" aria-hidden="true">
                  <UserPlus size={15} />
                </span>
                <span className="pi">
                  <b>Add people</b>
                  <span>Invite someone into #{channel.displayName}</span>
                </span>
              </button>
            )}
            {adding && channel && (
              <AddMembersDialog
                channelId={channelId}
                channelName={channel.displayName}
                onClose={() => setAdding(false)}
              />
            )}
            {members.map((m) => {
              const presence = presenceOf(state.presence, m.id);
              return (
                <div key={m.id} className="mrow pick-row">
                  <PersonButton userId={m.id} name={m.fullName}>
                    <UserAvatar userId={m.id} name={m.fullName} size="md" presence={presence} />
                  </PersonButton>
                  <span className="pi">
                    <b>
                      {m.fullName}
                      {m.id === user.id ? ' (you)' : ''}
                    </b>
                    <span>
                      {PRESENCE_LABEL[presence]} · {m.role}
                    </span>
                  </span>
                  <StatusBadge status={state.presence.statuses[m.id]} withText />
                  {(m.channelRole === 'owner' || m.channelRole === 'admin') && (
                    <span className="rolechip">{m.channelRole === 'owner' ? 'Owner' : 'Admin'}</span>
                  )}
                </div>
              );
            })}
            {channel && !isDm && (
              <p className="p-note">
                {channel.type === 'public'
                  ? 'Public channel — anyone can find and join it from Browse channels.'
                  : 'Private — people join by invitation only.'}
              </p>
            )}
          </>
        )}
        {tab === 'options' && channel && hasOptions && (
          <ChannelOptions key={channel.id} channel={channel} canManage={canManage} onGone={onGone} />
        )}
        {tab === 'files' && (
          <>
            {files.map((f) => (
              <div key={f.id} className="pinrow file-row">
                <span className="hashic md" aria-hidden="true">
                  <FileText size={14} />
                </span>
                <button className="bd pin-body" onClick={() => void download(f)} title="Download">
                  <b className="file-name">{f.filename}</b>
                  <p className="muted">
                    {formatBytes(f.sizeBytes)} · {f.userName}
                    {f.createdAt ? ` · ${formatTime(f.createdAt)}` : ''}
                  </p>
                </button>
              </div>
            ))}
            {!files.length && !loading && <div className="p-empty">No files shared yet</div>}
            {error && <p className="error pad">{error}</p>}
            {cursor && (
              <p className="center pad">
                <button className="btn-ghost btn-small" disabled={loading} onClick={() => void loadFiles(true)}>
                  Load more
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
