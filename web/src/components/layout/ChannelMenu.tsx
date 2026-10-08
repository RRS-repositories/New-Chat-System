import { useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { BellOff, Bell, ExternalLink, Link2, LogOut, MailOpen, Star, StarOff, Trash2, UserPlus } from 'lucide-react';
import { isManagementOrIT } from '../../utils/restrictions.ts';
import { paths } from '../../config/routes.ts';
import { useChat } from '../../context/chatContext.ts';
import { useToast } from '../../context/ToastProvider.tsx';
import type { Channel } from '../../types/index.ts';
import { Floating } from '../common/Floating.tsx';
import { AddMembersDialog } from '../dialogs/AddMembersDialog.tsx';

type Props = {
  channel: Channel;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
};

/** The menu on a conversation in the sidebar: open elsewhere, unread, favourite, mute, link, people, leave. */
export function ChannelMenu({ channel, anchor, onClose }: Props) {
  const { actions, user } = useChat();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const isDm = channel.type === 'dm';
  const isGeneral = channel.name === 'general';
  const muted = channel.notifyPref === 'nothing';
  const link = `${window.location.origin}${paths.channel(channel.id)}`;
  const name = isDm ? channel.dmUserName || 'Direct message' : `#${channel.displayName}`;
  const run = (what: () => Promise<unknown> | void) => {
    onClose();
    Promise.resolve()
      .then(what)
      .catch((e: any) => toast({ text: e?.message || 'That did not work' }));
  };

  // The dialog is drawn at the top level of the page, not inside the scrolling sidebar.
  if (adding)
    return createPortal(
      <AddMembersDialog channelId={channel.id} channelName={channel.displayName} onClose={onClose} />,
      document.body,
    );
  return (
    <Floating anchor={anchor} onClose={onClose} className="cmenu chan-menu" role="menu" label={`Options for ${name}`}>
      <button data-testid="menu-open-window" onClick={() => run(() => void window.open(link, '_blank', 'noopener'))}>
        <ExternalLink size={15} />
        <span>Open in new window</span>
      </button>
      <button data-testid="menu-unread" onClick={() => run(() => actions.markUnread(channel.id))}>
        <MailOpen size={15} />
        <span>Mark as unread</span>
      </button>
      <button
        data-testid="menu-favourite"
        onClick={() => run(() => actions.setFavourite(channel.id, !channel.favourite))}
      >
        {channel.favourite ? <StarOff size={15} /> : <Star size={15} />}
        <span>{channel.favourite ? 'Remove from favourites' : 'Add to favourites'}</span>
      </button>
      <button
        data-testid="menu-mute"
        onClick={() => run(() => actions.setChannelNotify(channel.id, muted ? 'default' : 'nothing'))}
      >
        {muted ? <Bell size={15} /> : <BellOff size={15} />}
        <span>{muted ? 'Unmute' : 'Mute'}</span>
      </button>
      <div className="sep" />
      <button
        data-testid="menu-copy-link"
        onClick={() =>
          run(async () => {
            await navigator.clipboard.writeText(link);
            toast({ text: 'Link copied' });
          })
        }
      >
        <Link2 size={15} />
        <span>Copy link</span>
      </button>
      {!isDm && (
        <button data-testid="menu-add-people" onClick={() => setAdding(true)}>
          <UserPlus size={15} />
          <span>Add people</span>
        </button>
      )}
      {!isDm && !isGeneral && (
        <>
          <div className="sep" />
          <button
            className="danger"
            data-testid="menu-leave"
            onClick={() => {
              if (window.confirm(`Leave ${name}?`)) run(() => actions.leaveChannel(channel.id));
              else onClose();
            }}
          >
            <LogOut size={15} />
            <span>Leave channel</span>
          </button>
          {isManagementOrIT(user) && (
            <button
              className="danger"
              data-testid="menu-delete"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete ${name} for everyone? Every message and file in it is deleted for good. This cannot be undone.`,
                  )
                )
                  run(() => actions.deleteChannel(channel.id));
                else onClose();
              }}
            >
              <Trash2 size={15} />
              <span>Delete channel</span>
            </button>
          )}
        </>
      )}
    </Floating>
  );
}
