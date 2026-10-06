import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { paths } from '../../config/routes.ts';
import { useChat } from '../../context/chatContext.ts';
import { useToast } from '../../context/ToastProvider.tsx';
import type { UserOption } from '../../types/index.ts';
import { presenceOf, type PresenceState } from '../../utils/presence.ts';
import { Floating } from './Floating.tsx';
import { UserAvatar } from './UserAvatar.tsx';

const PRESENCE_LABEL: Record<PresenceState, string> = { online: 'Online', away: 'Away', offline: 'Offline' };
/** The people list is fetched once per page visit for the role line; it is small. */
let peopleOnce: Promise<UserOption[]> | null = null;

type CardProps = { userId: number; name: string; anchor: RefObject<HTMLElement | null>; onClose: () => void };

/** Who this is: photo, name, role, whether they are here, their status, and a way to message them. */
export function ProfileCard({ userId, name, anchor, onClose }: CardProps) {
  const { state, user, actions } = useChat();
  const toast = useToast();
  const navigate = useNavigate();
  const [role, setRole] = useState<string | null>(null);
  const self = userId === user.id;
  const presence = presenceOf(state.presence, userId);
  const status = state.presence.statuses[userId];
  useEffect(() => {
    if (self) return setRole(user.role);
    peopleOnce ||= actions.listUsers().catch(() => []);
    let live = true;
    void peopleOnce.then((list) => live && setRole(list.find((u) => u.id === userId)?.role ?? null));
    return () => {
      live = false;
    };
  }, [actions, userId, self, user.role]);

  async function message() {
    onClose();
    try {
      const dm = await actions.openDm(userId);
      navigate(paths.channel(dm.id));
    } catch (e: any) {
      toast({ text: e?.message || 'Could not open a conversation' });
    }
  }

  return (
    <Floating anchor={anchor} onClose={onClose} className="profile-card" role="dialog" label={`About ${name}`}>
      <div className="pc-top" data-testid="profile-card">
        <UserAvatar userId={userId} name={name} size="xl" presence={presence} />
        <div className="pc-who">
          <b>
            {name}
            {self ? ' (you)' : ''}
          </b>
          {role && <span className="pc-role">{role}</span>}
          <span className={`pc-pres ${presence}`}>{PRESENCE_LABEL[presence]}</span>
          {status && (status.emoji || status.text) && (
            <span className="pc-status">
              {status.emoji} {status.text}
            </span>
          )}
        </div>
      </div>
      {!self && (
        <div className="pc-acts">
          <button className="btn-accent btn-small" data-testid="profile-message" onClick={() => void message()}>
            <MessageSquare size={14} /> Message
          </button>
        </div>
      )}
    </Floating>
  );
}

type ButtonProps = { userId: number; name: string; className?: string; children: ReactNode };

/** Wraps a name or avatar: clicking it opens the person's card. */
export function PersonButton({ userId, name, className = '', children }: ButtonProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className={`person-btn ${className}`.trim()}
        data-testid="person"
        data-user-id={userId}
        aria-label={`About ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        {children}
      </button>
      {open && anchor && (
        <ProfileCard userId={userId} name={name} anchor={{ current: anchor }} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
