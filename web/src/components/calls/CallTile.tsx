import { HangUp } from '../common/HangUp.tsx';
import { memo, useRef, useState, type CSSProperties } from 'react';
import { Hand, Mic, MicOff, MonitorUp, MoreHorizontal, Phone, UserX } from 'lucide-react';
import { useAvatarSrc } from '../../hooks/useAvatarSrc.ts';
import type { PeerState } from '../../services/callManager.ts';
import { initials } from '../../utils/format.ts';
import { hueOf } from '../../utils/hue.ts';
import { Floating } from '../common/Floating.tsx';

export type TilePerson = {
  userId: number;
  name: string;
  isSelf: boolean;
  /** This person is the host of the call. */
  isHost: boolean;
  muted: boolean;
  sharing: boolean;
  hand: boolean;
  speaking: boolean;
  state: PeerState;
  /** Being rung into the call: not in it yet. */
  ringing?: boolean;
  /** In another breakout group: shown dimmed, and not heard. */
  away?: boolean;
};

type Props = {
  person: TilePerson;
  /** The person looking at the screen is the host: they get mute and remove on other people's tiles. */
  viewerIsHost: boolean;
  hostName: string;
  /** Not offered in a one-to-one call, where leaving does the same. */
  canRemove: boolean;
  onToggleOwnMute: () => void;
  onHostMute: (userId: number) => void;
  onHostRemove: (userId: number) => void;
  onCancelRing?: (userId: number) => void;
};

const first = (name: string) => name.split(' ')[0] || name;

/** One person in the call: their colour, their photo or initials, their name, and what they are doing. */
export const CallTile = memo(function CallTile({
  person,
  viewerIsHost,
  hostName,
  canRemove,
  onToggleOwnMute,
  onHostMute,
  onHostRemove,
  onCancelRing,
}: Props) {
  const src = useAvatarSrc(person.userId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    setMenuOpen(false);
    setConfirming(false);
  };
  const speaking = person.speaking && !person.muted && !person.ringing;

  let menu;
  if (person.ringing)
    menu = (
      <button
        className="danger"
        data-testid="call-cancel-ring"
        onClick={() => {
          close();
          onCancelRing?.(person.userId);
        }}
      >
        <HangUp size={15} />
        <span>Stop ringing {first(person.name)}</span>
      </button>
    );
  else if (person.isSelf)
    menu = (
      <button
        onClick={() => {
          close();
          onToggleOwnMute();
        }}
      >
        {person.muted ? <Mic size={15} /> : <MicOff size={15} />}
        <span>{person.muted ? 'Unmute' : 'Mute'} yourself</span>
      </button>
    );
  else if (!viewerIsHost)
    menu = <div className="hint">{first(hostName) || 'The host'} is the host. Host controls are theirs.</div>;
  else if (confirming)
    menu = (
      <>
        <div className="hint">Remove {first(person.name)} from the call?</div>
        <button
          className="danger"
          data-testid="call-host-remove-yes"
          aria-label={`Yes, remove ${person.name} from the call`}
          onClick={() => {
            close();
            onHostRemove(person.userId);
          }}
        >
          <UserX size={15} />
          <span>Yes, remove</span>
        </button>
        <button aria-label="No, keep them in the call" onClick={close}>
          <span>No, keep them in the call</span>
        </button>
      </>
    );
  else
    menu = (
      <>
        <button
          data-testid="call-host-mute"
          aria-label={`Mute ${person.name}`}
          disabled={person.muted}
          onClick={() => {
            close();
            onHostMute(person.userId);
          }}
        >
          <MicOff size={15} />
          <span>{person.muted ? 'Already muted' : `Mute ${first(person.name)}`}</span>
        </button>
        {person.muted && (
          <div className="hint">A host cannot unmute anyone. {first(person.name)} unmutes themselves.</div>
        )}
        {canRemove && (
          <button
            className="danger"
            data-testid="call-host-remove"
            aria-label={`Remove ${person.name} from the call`}
            onClick={() => setConfirming(true)}
          >
            <UserX size={15} />
            <span>Remove from call</span>
          </button>
        )}
      </>
    );

  return (
    <div
      className={`c-tile state-${person.state}${speaking ? ' speaking' : ''}${person.away ? ' away' : ''}`}
      style={{ '--h': hueOf(person.name) } as CSSProperties}
      data-testid="call-participant"
      data-user-id={person.userId}
      data-state={person.ringing ? 'ringing' : person.state}
    >
      {person.hand && (
        <span className="c-hand" aria-label="hand raised" data-testid="call-hand-up">
          <Hand size={15} />
        </span>
      )}
      <div className="av">{src ? <img src={src} alt="" /> : initials(person.name)}</div>
      {!person.ringing && person.state === 'connecting' && <span className="c-state">connecting…</span>}
      {person.state === 'lost' && <span className="c-state call-lost">connection lost</span>}
      <div className="nmr">
        {person.muted ? (
          <span className="c-mic" role="img" aria-label="muted">
            <MicOff size={14} />
          </span>
        ) : (
          <span className="c-eq" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        {person.sharing && (
          <span className="c-share" role="img" aria-label="sharing">
            <MonitorUp size={13} />
          </span>
        )}
        <span className="t call-name">
          {person.name}
          {person.isSelf && <span className="yx"> (you)</span>}
          {person.isHost && (
            <span className="yx">
              {' '}
              · <span className="call-host-tag">host</span>
            </span>
          )}
        </span>
      </div>
      {person.ringing && (
        <div className="ringov">
          <div>
            <span className="ph">
              <Phone size={16} />
            </span>
            <p>Ringing…</p>
          </div>
        </div>
      )}
      <button
        ref={menuButton}
        className="c-dots"
        data-testid="call-tile-menu"
        aria-label={`Options for ${person.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => (menuOpen ? close() : setMenuOpen(true))}
      >
        <MoreHorizontal size={15} />
      </button>
      {menuOpen && (
        <Floating
          anchor={menuButton}
          onClose={close}
          className="cmenu dark"
          role="menu"
          label={`Options for ${person.name}`}
        >
          {menu}
        </Floating>
      )}
    </div>
  );
});
