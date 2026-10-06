import { HangUp } from '../common/HangUp.tsx';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LayoutGrid, Maximize2, Mic, MicOff, Minimize2, MonitorUp } from 'lucide-react';
import { FEATURES } from '../../config/features.ts';
import { useChat } from '../../context/chatContext.ts';
import { useToast } from '../../context/ToastProvider.tsx';
import { useCall } from '../../context/callContext.ts';
import { useAvatarSrc } from '../../hooks/useAvatarSrc.ts';
import { useCallClock } from '../../hooks/useCallClock.ts';
import { useSpeaking, type VoiceSource } from '../../hooks/useSpeaking.ts';
import { initials } from '../../utils/format.ts';
import { hueOf } from '../../utils/hue.ts';
import { AddPeople } from './AddPeople.tsx';
import { describeGroups, groupOf, roomOf } from '../../utils/breakout.ts';
import { BreakoutPanel } from './BreakoutPanel.tsx';
import { CallDock } from './CallDock.tsx';
import { CallTile, type TilePerson } from './CallTile.tsx';
import { JoinRequests } from './JoinRequests.tsx';
import { OwnScreen } from './OwnScreen.tsx';
import { RemoteAudio } from './RemoteAudio.tsx';
import { RemoteScreen } from './RemoteScreen.tsx';
import { WhiteboardView } from './WhiteboardView.tsx';

const canShare = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getDisplayMedia === 'function';

/** How many columns the grid of people uses. */
export function gridColumns(people: number, narrow: boolean): number {
  if (people <= 1) return 1;
  if (narrow) return 2;
  if (people <= 4) return 2;
  return people <= 6 ? 3 : 4;
}

const first = (name: string) => name.split(' ')[0] || name;

/** The big round avatar on the "Calling…" screen. */
function RingAvatar({ userId, name }: { userId: number | null; name: string }) {
  const src = useAvatarSrc(userId);
  return (
    <div className="ring-av" style={{ '--h': hueOf(name) } as CSSProperties}>
      <span className="w" />
      <span className="w" />
      <span className="c">{src ? <img src={src} alt="" /> : initials(name)}</span>
    </div>
  );
}

/**
 * The call, over the whole app: people as tiles (or a shared screen with the people in a strip),
 * and the dock of controls. It can be minimised to a small pill so the chat can be used meanwhile.
 * Escape does not leave the call.
 */
export function CallScreen() {
  const { state, user } = useChat();
  const {
    call,
    snapshot,
    panelError,
    panelNote,
    busy,
    isHost,
    joinRequests,
    hands,
    reactions,
    breakout,
    setBreakoutGroups,
    startBreakouts,
    endBreakouts,
    recording,
    canRecord,
    toggleRecording,
    whiteboard,
    invites,
    inviteToCall,
    cancelInvite,
    toggleMute,
    toggleShare,
    toggleHand,
    sendReaction,
    dismissReaction,
    leaveCall,
    muteParticipant,
    removeParticipant,
    answerJoinRequest,
  } = useCall();
  const [minimised, setMinimised] = useState(false);
  const [adding, setAdding] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  /** Who is drawing while this person's board is closed. */
  const [drawingBy, setDrawingBy] = useState<number | null>(null);
  const [screenNote, setScreenNote] = useState<string | null>(null);
  const boardOpenRef = useRef(boardOpen);
  boardOpenRef.current = boardOpen;
  const addButton = useRef<HTMLButtonElement | null>(null);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 760);
  const clock = useCallClock(call.phase === 'in-call' ? call.since : null);
  const recClock = useCallClock(recording ? recording.since : null);
  const toast = useToast();
  const recordingBy = recording?.by ?? null;
  const namesRef = useRef<Record<number, string>>({});
  // A call is never recorded silently: everyone is told when it starts, and so is anyone who joins meanwhile.
  useEffect(() => {
    if (recordingBy === null) return;
    const who = namesRef.current[recordingBy];
    toast({
      text:
        recordingBy === user.id
          ? 'Recording started. Everyone in the call has been told.'
          : `This call is being recorded${who ? ` by ${who}` : ''}.`,
    });
  }, [recordingBy]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new call always opens full size.
  useEffect(() => {
    if (!busy) setMinimised(false);
    if (!busy) setAdding(false);
    if (!busy) setBoardOpen(false);
    if (!busy) setGroupsOpen(false);
    if (!busy) setDrawingBy(null);
  }, [busy]);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 760);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const everyone = snapshot.participants;
  // Breakout groups open: the people in my room. I hear and see only them.
  const room = useMemo(
    () =>
      roomOf(
        breakout,
        user.id,
        everyone.map((p) => p.userId),
      ),
    [breakout, user.id, everyone],
  );
  const others = useMemo(() => (room ? everyone.filter((p) => room.includes(p.userId)) : everyone), [everyone, room]);
  // While the groups are open the whiteboard waits (sharing is stopped by the call itself).
  useEffect(() => {
    if (breakout.active) setBoardOpen(false);
  }, [breakout.active]);
  namesRef.current = Object.fromEntries(everyone.map((p) => [p.userId, p.userName]));
  const remoteSharing = others.some((p) => p.screenTrack && p.state !== 'lost');

  // Someone else draws while this person's board is closed: offer to open it.
  useEffect(() => whiteboard.onRemote((userId) => !boardOpenRef.current && setDrawingBy(userId)), [whiteboard]);
  // A shared screen takes the stage: the board closes here (the drawing is kept).
  useEffect(() => {
    if (remoteSharing && boardOpenRef.current) {
      setBoardOpen(false);
      setScreenNote('Someone is sharing their screen. The whiteboard is kept: open it again when they stop.');
    }
  }, [remoteSharing]);
  useEffect(() => {
    if (!screenNote) return;
    const timer = setTimeout(() => setScreenNote(null), 6000);
    return () => clearTimeout(timer);
  }, [screenNote]);
  const voices = useMemo<VoiceSource[]>(
    () => [
      { userId: user.id, track: snapshot.ownAudioTrack, muted: snapshot.muted },
      ...others.map((p) => ({ userId: p.userId, track: p.audioTrack, muted: p.muted })),
    ],
    [user.id, snapshot.ownAudioTrack, snapshot.muted, others],
  );
  const speaking = useSpeaking(busy ? voices : []);

  const hostMute = useCallback((id: number) => void muteParticipant(id), [muteParticipant]);
  const hostRemove = useCallback((id: number) => void removeParticipant(id), [removeParticipant]);
  const stopRinging = useCallback((id: number) => void cancelInvite(id), [cancelInvite]);
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeBoard = useCallback(() => setBoardOpen(false), []);

  if (!busy) return null;

  const channel = state.channels.find((c) => c.id === call.channelId);
  const oneToOne = channel?.type === 'dm';
  const title = channel ? (oneToOne ? channel.dmUserName || 'Direct call' : `#${channel.displayName}`) : 'Call';
  const hostName =
    call.hostId === user.id ? user.fullName : everyone.find((p) => p.userId === call.hostId)?.userName || '';
  const nameOf = (userId: number) =>
    userId === user.id ? 'You' : first(everyone.find((p) => p.userId === userId)?.userName || 'Someone');
  const myGroup = groupOf(breakout, user.id);

  const people: TilePerson[] = [
    {
      userId: user.id,
      name: user.fullName,
      isSelf: true,
      isHost: call.hostId === user.id,
      muted: snapshot.muted,
      sharing: snapshot.sharing,
      hand: hands.includes(user.id),
      speaking: speaking.has(user.id),
      state: 'connected',
    },
    ...others.map((p) => ({
      userId: p.userId,
      name: p.userName,
      isSelf: false,
      isHost: call.hostId === p.userId,
      muted: p.muted,
      sharing: p.sharing,
      hand: hands.includes(p.userId),
      speaking: speaking.has(p.userId),
      state: p.state,
    })),
    // People being rung into the call: a tile each, until they answer or the ring ends.
    ...invites
      .filter((i) => i.userId !== user.id && !others.some((p) => p.userId === i.userId))
      .map((i) => ({
        userId: i.userId,
        name: i.userName,
        isSelf: false,
        isHost: false,
        muted: false,
        sharing: false,
        hand: false,
        speaking: false,
        state: 'connecting' as const,
        ringing: true,
      })),
  ];
  const tiles = people.map((person) => (
    <CallTile
      key={person.userId}
      person={person}
      viewerIsHost={isHost}
      hostName={hostName}
      canRemove={!oneToOne}
      onToggleOwnMute={toggleMute}
      onHostMute={hostMute}
      onHostRemove={hostRemove}
      onCancelRing={stopRinging}
    />
  ));
  const sharer = others.find((p) => p.screenTrack && p.state !== 'lost');
  function toggleBoard() {
    if (boardOpen) return setBoardOpen(false);
    if (breakout.active) return setScreenNote('The whiteboard is paused while breakout groups are open.');
    if (sharer)
      return setScreenNote(`${first(sharer.userName)} is sharing their screen. The whiteboard opens when they stop.`);
    if (snapshot.sharing) void toggleShare(); // my own share stops: the board takes the stage
    setDrawingBy(null);
    setBoardOpen(true);
  }
  const calling = call.phase === 'in-call' && oneToOne && others.length === 0 && invites.length === 0;
  const status =
    call.phase === 'joining' ? 'Connecting…' : others.length ? `${clock} · ${others.length + 1} people` : clock;

  // The voices keep playing whether the call is full size or minimised.
  const audio = others.map((p) => (p.audioTrack ? <RemoteAudio key={p.userId} track={p.audioTrack} /> : null));

  if (minimised)
    return (
      <>
        <div className="mini" role="region" aria-label="Voice call" data-testid="call-panel" data-minimised="true">
          <span className="mi-i">
            <b>{title}</b>
            <span>
              <span className="c-live" />
              <span>{clock || 'Connecting…'}</span>
              {recording && <span className="mini-rec"> · REC</span>}
            </span>
          </span>
          <button
            className={snapshot.muted ? 'off' : ''}
            data-testid="call-mute"
            aria-label={snapshot.muted ? 'Unmute' : 'Mute'}
            aria-pressed={snapshot.muted}
            disabled={call.phase !== 'in-call'}
            onClick={toggleMute}
          >
            {snapshot.muted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button data-testid="call-expand" aria-label="Expand call" onClick={() => setMinimised(false)}>
            <Maximize2 size={16} />
          </button>
          <button className="hang" data-testid="call-leave" aria-label="Leave call" onClick={leaveCall}>
            <HangUp size={16} />
          </button>
        </div>
        {audio}
      </>
    );

  return (
    <>
      <section className="callov" aria-label="Voice call" data-testid="call-panel">
        <div className="c-top">
          <button
            className="c-ic"
            data-testid="call-minimise"
            aria-label="Minimise call"
            title="Minimise"
            onClick={() => setMinimised(true)}
          >
            <Minimize2 size={18} />
          </button>
          <div>
            <div className="nm call-title">{title}</div>
            <div className="st">
              <span className="c-live" />
              <span data-testid="call-status">{status}</span>
            </div>
          </div>
          <div className="sp" />
          <div className="c-pills">
            {breakout.active && (
              <span className="c-pill bo" role="status" data-testid="call-bo-pill">
                <LayoutGrid size={12} />
                {myGroup ? myGroup.name : 'Breakouts'}
              </span>
            )}
            {recording && (
              <span
                className="c-pill rec"
                role="status"
                data-testid="call-rec-pill"
                title="This call is being recorded"
              >
                <i />
                REC {recClock}
              </span>
            )}
          </div>
        </div>
        <div className="c-notes">
          {isHost && (
            <JoinRequests requests={joinRequests} onAnswer={(id, accept) => void answerJoinRequest(id, accept)} />
          )}
          {drawingBy !== null && !boardOpen && (
            <p className="c-note" role="status" data-testid="call-board-nudge">
              {first(others.find((p) => p.userId === drawingBy)?.userName || 'Someone')} is drawing on the whiteboard.{' '}
              <button className="c-note-act" onClick={toggleBoard}>
                Open it
              </button>
            </p>
          )}
          {screenNote && (
            <p className="c-note" role="status">
              {screenNote}
            </p>
          )}
          {panelNote && (
            <p className="c-note" role="status" data-testid="call-panel-note">
              {panelNote}
            </p>
          )}
          {panelError && (
            <p className="c-note is-error" role="alert">
              {panelError}
            </p>
          )}
        </div>
        <div className="cstage">
          {boardOpen && !sharer ? (
            <div className="c-present">
              <WhiteboardView board={whiteboard} isHost={isHost} hostName={hostName} onClose={closeBoard} />
              <div className="c-strip">{tiles}</div>
            </div>
          ) : sharer ? (
            <div className="c-present">
              <RemoteScreen track={sharer.screenTrack!} name={first(sharer.userName)} />
              <div className="c-strip">{tiles}</div>
            </div>
          ) : (
            <div className="c-present">
              {snapshot.ownScreenTrack && (
                // The presenter keeps seeing the people: their own screen is only the small picture in the corner
                // (a full-size copy would mirror itself when the chat is what is being shared).
                <div className="bo-banner presenting" role="status" data-testid="call-presenting">
                  <MonitorUp size={15} />
                  <span>
                    <b>You are presenting.</b> The others see your screen; the small picture shows what they see.
                  </span>
                  <button data-testid="call-presenting-stop" onClick={() => void toggleShare()}>
                    Stop sharing
                  </button>
                </div>
              )}
              {breakout.active && (
                <div className="bo-banner" role="status" data-testid="bo-banner">
                  <LayoutGrid size={15} />
                  <span>
                    <b>Breakouts live</b> · {myGroup ? `You are in ${myGroup.name} · ` : ''}
                    {describeGroups(breakout.groups, nameOf)}
                  </span>
                  {isHost && (
                    <button data-testid="bo-banner-end" onClick={endBreakouts}>
                      Bring everyone back
                    </button>
                  )}
                </div>
              )}
              <div className="c-grid" style={{ '--cols': gridColumns(people.length, narrow) } as CSSProperties}>
                {tiles}
              </div>
            </div>
          )}
          {snapshot.ownScreenTrack && !boardOpen && (
            <OwnScreen track={snapshot.ownScreenTrack} onStop={() => void toggleShare()} />
          )}
        </div>
        <div className="crlayer" aria-hidden="true">
          {reactions.map((reaction) => (
            <span
              key={reaction.id}
              className="remoji"
              style={
                {
                  left: `${8 + ((reaction.id * 37) % 26)}%`,
                  '--dx': `${((reaction.id * 53) % 60) - 30}px`,
                } as CSSProperties
              }
              onAnimationEnd={() => dismissReaction(reaction.id)}
            >
              {reaction.emoji}
              <small>
                {reaction.userId === user.id
                  ? 'You'
                  : first(others.find((p) => p.userId === reaction.userId)?.userName || '')}
              </small>
            </span>
          ))}
        </div>
        <CallDock
          ready={call.phase === 'in-call'}
          muted={snapshot.muted}
          sharing={snapshot.sharing}
          canShare={canShare() && !breakout.active}
          handUp={hands.includes(user.id)}
          onToggleMute={toggleMute}
          onToggleShare={() => void toggleShare()}
          onToggleHand={toggleHand}
          onReact={sendReaction}
          onLeave={leaveCall}
          onAdd={FEATURES.addToCall ? () => setAdding((open) => !open) : undefined}
          addRef={addButton}
          whiteboard={FEATURES.whiteboard ? { open: boardOpen, onToggle: toggleBoard } : undefined}
          breakout={
            FEATURES.breakoutGroups
              ? { open: groupsOpen || breakout.active, onToggle: () => setGroupsOpen((open) => !open) }
              : undefined
          }
          recording={
            FEATURES.recording
              ? { on: recording?.by === user.id, onToggle: toggleRecording, allowed: canRecord }
              : undefined
          }
        />
        {groupsOpen && (
          <BreakoutPanel
            breakout={breakout}
            people={[
              { userId: user.id, name: user.fullName, isSelf: true, isHost: call.hostId === user.id },
              ...everyone.map((p) => ({
                userId: p.userId,
                name: p.userName,
                isSelf: false,
                isHost: call.hostId === p.userId,
              })),
            ]}
            isHost={isHost}
            hostName={hostName}
            onChange={setBreakoutGroups}
            onStart={startBreakouts}
            onEnd={endBreakouts}
            onClose={() => setGroupsOpen(false)}
          />
        )}
        {adding && (
          <AddPeople
            anchor={addButton}
            takenIds={people.map((p) => p.userId)}
            onPick={(id) => void inviteToCall(id)}
            onClose={closeAdd}
          />
        )}
        {calling && (
          <div className="c-ring" data-testid="call-ringing-out">
            <span className="ring-glow" style={{ '--h': hueOf(title) } as CSSProperties} />
            <RingAvatar userId={channel?.dmUserId ?? null} name={title} />
            <h2>{title}</h2>
            <p>Calling…</p>
            <div className="ring-acts">
              <div className="ring-act">
                <button className="rbtn no" data-testid="call-cancel" aria-label="Cancel call" onClick={leaveCall}>
                  <HangUp size={26} />
                </button>
                Cancel
              </div>
            </div>
          </div>
        )}
      </section>
      {audio}
    </>
  );
}
