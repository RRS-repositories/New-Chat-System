import { HangUp } from '../common/HangUp.tsx';
import { useEffect, useState, type CSSProperties } from 'react';
import { MessageSquare, Phone, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { paths } from '../../config/routes.ts';
import { useCall } from '../../context/callContext.ts';
import type { IncomingCall } from '../../context/callState.ts';
import { useChat } from '../../context/chatContext.ts';
import { useToast } from '../../context/ToastProvider.tsx';
import { useAvatarSrc } from '../../hooks/useAvatarSrc.ts';
import { initials } from '../../utils/format.ts';
import { hueOf } from '../../utils/hue.ts';

const RING_SECONDS = 30;
const REPLY_MAX = 140;
/** One-tap answers that decline the call and say why. */
export const QUICK_REPLIES = [
  'I’m on a call with a client — I’ll ring you back',
  'Can’t talk right now, message me',
  'Give me 5 minutes',
];

const first = (name: string) => name.split(' ')[0] || name;

/** Seconds left of the ring, counted down once a second. */
function useSecondsLeft(since: number | undefined): number {
  const left = () => Math.max(0, RING_SECONDS - Math.floor((Date.now() - (since ?? Date.now())) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    const timer = setInterval(() => setSeconds(left()), 1000);
    return () => clearInterval(timer);
  }, [since]); // eslint-disable-line react-hooks/exhaustive-deps
  return seconds;
}

function Card({ inc, onACall }: { inc: IncomingCall; onACall: boolean }) {
  const { acceptCall, declineCall } = useCall();
  const { actions } = useChat();
  const toast = useToast();
  const nav = useNavigate();
  const src = useAvatarSrc(inc.fromId);
  const seconds = useSecondsLeft(inc.at);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');

  const oneToOne = inc.channelType === 'dm' && !inc.invited;
  const what = inc.invited
    ? 'Asks you to join their call'
    : oneToOne
      ? onACall
        ? 'Incoming while you’re on a call'
        : 'Incoming voice call'
      : `Calling #${inc.channelName}`;
  // Already in a call: a one-to-one caller is brought into it; anything else means changing calls.
  const acceptLabel = !onACall ? 'Accept' : oneToOne ? 'Add to my call' : 'Switch calls';

  const accept = () => {
    if (!onACall && !inc.invited) nav(paths.channel(inc.channelId));
    void acceptCall(inc);
  };
  /** Declines, and posts the words into the direct conversation with the caller. */
  const declineWith = async (words: string) => {
    const message = words.trim().slice(0, REPLY_MAX);
    if (!message) return;
    declineCall(inc.callId);
    try {
      const dm = await actions.openDm(inc.fromId);
      await actions.send(dm.id, message);
      toast({ text: `Sent to ${first(inc.fromName)}: “${message}”` });
    } catch (e: any) {
      toast({ text: e?.message || 'The call was declined, but the message could not be sent' });
    }
  };

  return (
    <div className="incbox">
      <div
        className="inc-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="incoming-title"
        aria-describedby="incoming-where"
        data-testid="incoming-call"
      >
        <div className="ring-av" style={{ '--h': hueOf(inc.fromName) } as CSSProperties}>
          <span className="w" />
          <span className="w" />
          <span className="c">{src ? <img src={src} alt="" /> : initials(inc.fromName)}</span>
        </div>
        <h2 id="incoming-title">{inc.fromName}</h2>
        <p className="inc-sub" id="incoming-where">
          {what} · {seconds}s
        </p>
        <div className="ring-acts inc-acts">
          <div className="ring-act">
            <button
              className="rbtn no"
              data-testid="incoming-decline"
              aria-label="Decline call"
              onClick={() => declineCall(inc.callId)}
            >
              <HangUp size={23} />
            </button>
            Decline
          </div>
          <div className="ring-act">
            <button
              className="rbtn msg"
              data-testid="incoming-message"
              aria-label="Decline with a message"
              aria-expanded={replying}
              onClick={() => setReplying(!replying)}
            >
              <MessageSquare size={23} />
            </button>
            Message
          </div>
          <div className="ring-act">
            <button
              className="rbtn yes"
              data-testid="incoming-accept"
              aria-label={`${acceptLabel}: answer the call`}
              autoFocus
              onClick={accept}
            >
              <Phone size={23} />
            </button>
            {acceptLabel}
          </div>
        </div>
        {replying && (
          <div className="inc-replies">
            {QUICK_REPLIES.map((reply) => (
              <button
                key={reply}
                className="inc-q"
                data-testid="incoming-reply"
                onClick={() => void declineWith(reply)}
              >
                {reply}
              </button>
            ))}
            <form
              className="inc-type"
              onSubmit={(e) => {
                e.preventDefault();
                void declineWith(text);
              }}
            >
              <input
                autoFocus
                value={text}
                maxLength={REPLY_MAX}
                placeholder="Type a message…"
                aria-label="Your message"
                data-testid="incoming-reply-input"
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" aria-label="Send and decline" data-testid="incoming-reply-send">
                <Send size={16} />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The card for a call ringing in: Accept, Decline, or Message (declines and tells the caller why).
 * It shows over the app, and over a call this person is already in. The ringtone and the desktop
 * notification are run by CallProvider.
 */
export function IncomingCallModal() {
  const { call, busy } = useCall();
  const inc = call.phase === 'ringing-in' ? call.incoming : busy ? call.waiting : null;
  if (!inc) return null;
  return <Card key={inc.callId} inc={inc} onACall={busy} />;
}
