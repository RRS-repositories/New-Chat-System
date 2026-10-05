import { HangUp } from '../common/HangUp.tsx';
import { useState, type MutableRefObject, type ReactNode } from 'react';
import {
  CircleDot,
  Hand,
  LayoutGrid,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PenTool,
  Smile,
  UserPlus,
} from 'lucide-react';

/** The emoji offered as call reactions. */
export const CALL_REACTIONS = ['💜', '👍', '🎉', '👏', '😂', '😮', '🤔', '✅'];

type Props = {
  ready: boolean;
  muted: boolean;
  sharing: boolean;
  canShare: boolean;
  handUp: boolean;
  onToggleMute: () => void;
  onToggleShare: () => void;
  onToggleHand: () => void;
  onReact: (emoji: string) => void;
  onLeave: () => void;
  /** The parts that arrive in later sections. Left out (undefined) means "not available yet": shown greyed out. */
  onAdd?: () => void;
  /** The add button, so the list of people can be placed beside it. */
  addRef?: MutableRefObject<HTMLButtonElement | null>;
  whiteboard?: { open: boolean; onToggle: () => void };
  recording?: { on: boolean; onToggle: () => void; allowed: boolean };
  breakout?: { open: boolean; onToggle: () => void };
  /** Extra floating pieces that belong above the dock (the add-people menu, for one). */
  children?: ReactNode;
};

type ButtonProps = {
  label: string;
  icon: ReactNode;
  tone?: 'off' | 'lit' | 'amb' | '';
  testId?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
};

function DockButton({ label, icon, tone = '', testId, pressed, disabled, onClick, buttonRef }: ButtonProps) {
  return (
    <button
      ref={buttonRef}
      className={`cc${tone ? ` ${tone}` : ''}`}
      data-testid={testId}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="lbl">{label}</span>
    </button>
  );
}

/** The glass bar of call controls at the bottom of the call screen. */
export function CallDock(props: Props) {
  const { ready, muted, sharing, canShare, handUp, whiteboard, recording, breakout } = props;
  const [picking, setPicking] = useState(false);
  const soon = (name: string) => `${name} (coming soon)`;
  return (
    <div className="c-dock">
      {picking && (
        <div className="crpick" role="dialog" aria-label="React">
          {CALL_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              aria-label={`React ${emoji}`}
              onClick={() => {
                props.onReact(emoji);
                setPicking(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      {props.children}
      <div className="c-dockin">
        <DockButton
          label={muted ? 'Unmute' : 'Mute'}
          icon={muted ? <MicOff size={21} /> : <Mic size={21} />}
          tone={muted ? 'off' : ''}
          testId="call-mute"
          pressed={muted}
          disabled={!ready}
          onClick={props.onToggleMute}
        />
        <DockButton
          label={props.onAdd ? 'Add to call' : soon('Add to call')}
          icon={<UserPlus size={21} />}
          testId="call-add"
          disabled={!ready || !props.onAdd}
          onClick={props.onAdd}
          buttonRef={(el) => {
            if (props.addRef) props.addRef.current = el;
          }}
        />
        {canShare && (
          <DockButton
            label={sharing ? 'Stop sharing' : 'Share screen'}
            icon={sharing ? <MonitorOff size={21} /> : <MonitorUp size={21} />}
            tone={sharing ? 'lit' : ''}
            testId="call-share"
            pressed={sharing}
            disabled={!ready}
            onClick={props.onToggleShare}
          />
        )}
        <DockButton
          label={whiteboard ? (whiteboard.open ? 'Close whiteboard' : 'Whiteboard') : soon('Whiteboard')}
          icon={<PenTool size={21} />}
          tone={whiteboard?.open ? 'lit' : ''}
          testId="call-board"
          pressed={whiteboard?.open}
          disabled={!ready || !whiteboard}
          onClick={whiteboard?.onToggle}
        />
        <DockButton
          label={
            recording
              ? recording.on
                ? 'Stop recording'
                : recording.allowed
                  ? 'Record meeting'
                  : 'Record meeting (host only)'
              : soon('Record meeting')
          }
          icon={<CircleDot size={21} />}
          tone={recording?.on ? 'off' : ''}
          testId="call-record"
          pressed={recording?.on}
          disabled={!ready || !recording || !recording.allowed}
          onClick={recording?.onToggle}
        />
        <DockButton
          label={handUp ? 'Lower hand' : 'Raise hand'}
          icon={<Hand size={21} />}
          tone={handUp ? 'amb' : ''}
          testId="call-hand"
          pressed={handUp}
          disabled={!ready}
          onClick={props.onToggleHand}
        />
        <DockButton
          label="React"
          icon={<Smile size={21} />}
          testId="call-react"
          pressed={picking}
          disabled={!ready}
          onClick={() => setPicking(!picking)}
        />
        <DockButton
          label={breakout ? 'Breakout groups' : soon('Breakout groups')}
          icon={<LayoutGrid size={21} />}
          tone={breakout?.open ? 'lit' : ''}
          testId="call-rooms"
          pressed={breakout?.open}
          disabled={!ready || !breakout}
          onClick={breakout?.onToggle}
        />
        <span className="c-sep" />
        <button className="c-leave" data-testid="call-leave" aria-label="Leave call" onClick={props.onLeave}>
          <HangUp size={22} />
        </button>
      </div>
    </div>
  );
}
