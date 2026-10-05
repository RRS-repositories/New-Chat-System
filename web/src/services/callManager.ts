/**
 * Voice call mesh for one tab: the local microphone plus one RTCPeerConnection per other
 * participant. Framework-free; the browser pieces are injected so it can be tested with fakes.
 *
 * - The JOINER offers to each existing participant; existing participants wait for that offer
 *   (and, as a safety net, start negotiating themselves if none has come after `offerWaitMs`).
 * - (Re)negotiation is "perfect negotiation": the POLITE peer is the one with the larger user id.
 * - Every peer is independent: a failure, a throw or a refused renegotiation with one peer never
 *   touches the others, the local microphone or the call. A peer whose connection fails gets one
 *   ICE restart; if it is still not connected after `lostAfterMs` only that peer is closed and
 *   marked `lost`. A lost peer stays lost until that person re-joins (their re-join rebuilds the pair).
 * - Screen sharing uses exactly ONE video transceiver per peer, reused for every share
 *   (`replaceTrack` + direction), so the SDP does not grow share after share.
 */

export const MIC_MESSAGE = 'Microphone access is needed to join the call';
export const SHARE_BUSY_MESSAGE = 'Someone is already sharing';
export const MIC_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true } as const;

export type SessionDesc = { type: string; sdp?: string };
/** `signal_data` inside `webrtc_signal`. `state` carries this person's mute flag (no renegotiation). */
export type Signal =
  | { type: 'description'; description: SessionDesc }
  | { type: 'candidate'; candidate: unknown }
  | { type: 'state'; muted: boolean };

export interface TrackLike {
  kind: string;
  enabled: boolean;
  muted?: boolean;
  stop(): void;
  onended?: ((ev?: any) => any) | null;
  onmute?: ((ev?: any) => any) | null;
  onunmute?: ((ev?: any) => any) | null;
}
export interface StreamLike {
  getTracks(): TrackLike[];
  getAudioTracks(): TrackLike[];
  getVideoTracks(): TrackLike[];
}
export interface SenderLike {
  track?: TrackLike | null;
  replaceTrack?(track: TrackLike | null): Promise<void>;
}
export interface TransceiverLike {
  direction: string;
  stopped?: boolean;
  sender: { track?: TrackLike | null; replaceTrack(track: TrackLike | null): Promise<void> };
  receiver: { track: TrackLike | null };
}
export interface PeerLike {
  signalingState: string;
  connectionState: string;
  localDescription: SessionDesc | null;
  remoteDescription: SessionDesc | null;
  onnegotiationneeded: ((ev?: any) => any) | null;
  onicecandidate: ((ev: any) => any) | null;
  ontrack: ((ev: any) => any) | null;
  onconnectionstatechange: ((ev?: any) => any) | null;
  addTrack(track: TrackLike, ...streams: StreamLike[]): SenderLike;
  addTransceiver(
    trackOrKind: TrackLike | string,
    init?: { direction?: string; streams?: StreamLike[] },
  ): TransceiverLike;
  getTransceivers(): TransceiverLike[];
  setLocalDescription(desc?: SessionDesc): Promise<void>;
  setRemoteDescription(desc: SessionDesc): Promise<void>;
  addIceCandidate(candidate: any): Promise<void>;
  restartIce(): void;
  close(): void;
}
export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export type JoinResult = {
  participants: Array<{ userId: number; userName: string; isSharingScreen?: boolean }>;
  iceServers: IceServer[];
};

export type PeerState = 'connecting' | 'connected' | 'lost';
export type RemoteParticipant = {
  userId: number;
  userName: string;
  state: PeerState;
  muted: boolean;
  sharing: boolean;
  /** Their voice (play it in an <audio autoplay>). */
  audioTrack: TrackLike | null;
  /** Their shared screen while it is live (video track received and not muted/ended/stopped). */
  screenTrack: TrackLike | null;
};
export type CallSnapshot = {
  muted: boolean;
  sharing: boolean;
  /** My own shared screen while I am sharing (shown back to me as a small preview). Never sent anywhere extra. */
  ownScreenTrack: TrackLike | null;
  /** My own microphone, for the "speaking" light on my tile and for recording. */
  ownAudioTrack: TrackLike | null;
  participants: RemoteParticipant[];
};
export type ShareResult =
  { ok: true } | { ok: false; reason: 'cancelled' | 'busy' | 'failed' | 'not_in_call'; message: string };

type Timers = { setTimeout: (fn: () => void, ms: number) => any; clearTimeout: (h: any) => void };
export type CallManagerDeps = {
  myUserId: number;
  createPeer: (iceServers: IceServer[], remoteUserId: number) => PeerLike;
  getMic: () => Promise<StreamLike>;
  getDisplay: () => Promise<StreamLike>;
  sendSignal: (toUserId: number, data: Signal) => void;
  /** POST …/screen-share { on }; rejects with an error whose `code` is e.g. `already_sharing`. */
  announceShare: (on: boolean) => Promise<void>;
  onChange: (snapshot: CallSnapshot) => void;
  timers?: Timers;
  lostAfterMs?: number;
  connectTimeoutMs?: number;
  offerWaitMs?: number;
  log?: (what: string, e?: unknown) => void;
};

export class CallError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type TimerKey = 'lostTimer' | 'connectTimer' | 'waitTimer';
type Peer = {
  userId: number;
  userName: string;
  pc: PeerLike | null;
  polite: boolean;
  /** Built from my own join answer: I made the first offer. */
  initiator: boolean;
  /** false while waiting for their first offer: our own negotiationneeded is not acted on yet. */
  ready: boolean;
  makingOffer: boolean;
  offering: Promise<void> | null;
  ignoreOffer: boolean;
  pending: unknown[];
  restartTried: boolean;
  lostTimer: any;
  connectTimer: any;
  waitTimer: any;
  state: PeerState;
  muted: boolean;
  sharing: boolean;
  audioTrack: TrackLike | null;
  videoTrack: TrackLike | null;
  videoLive: boolean;
  /** The one video transceiver my screen goes out on (while sharing). */
  screenTx: TransceiverLike | null;
};

export class CallManager {
  private deps: CallManagerDeps;
  private timers: Timers;
  private peers = new Map<number, Peer>();
  private mic: StreamLike | null = null;
  private screen: { stream: StreamLike; track: TrackLike } | null = null;
  private iceServers: IceServer[] = [];
  private muted = false;
  private closed = false;
  private sharePending = false;
  /**
   * Has my own join event (`call_participant_joined` for me) been seen since my last join?
   * Events on the socket are in server order, so a join event for someone that arrives BEFORE my
   * own is for a join older than mine: they are in my join answer and I already offer to them.
   */
  private ownJoinSeen = false;
  /** Until the start/join answer arrives: participant joins and signals are kept here and applied after it. */
  private early: { joined: Map<number, string>; signals: Array<[number, Signal]> } | null = {
    joined: new Map(),
    signals: [],
  };

  constructor(deps: CallManagerDeps) {
    this.deps = deps;
    this.timers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) };
  }

  // ---- lifecycle ----------------------------------------------------------

  /**
   * Gets the microphone FIRST (a denied mic never reaches the server), then runs `join`
   * (the start/join request) and offers to every participant it returns except me.
   */
  async connect(join: () => Promise<JoinResult>): Promise<JoinResult> {
    let mic: StreamLike;
    try {
      mic = await this.deps.getMic();
    } catch {
      if (this.closed) throw new CallError('left', 'You left the call');
      this.closed = true;
      throw new CallError('mic', MIC_MESSAGE);
    }
    this.mic = mic;
    // Left (or the call ended / moved to another tab) while the browser was asking: no request is sent.
    if (this.closed) {
      this.stopLocal();
      throw new CallError('left', 'You left the call');
    }
    if (!mic.getAudioTracks().length) {
      this.stopLocal();
      this.closed = true;
      throw new CallError('mic', MIC_MESSAGE);
    }
    let result: JoinResult;
    try {
      result = await join();
    } catch (e) {
      this.stopLocal();
      this.closed = true;
      throw e;
    }
    if (this.closed) {
      this.stopLocal();
      throw new CallError('left', 'You left the call');
    }
    this.iceServers = result.iceServers || [];
    this.offerToAll(result);
    return result;
  }

  /** After a socket reconnect: every peer is rebuilt towards the call's current participants (the mic is kept). */
  async rejoin(join: () => Promise<JoinResult>): Promise<JoinResult> {
    this.early = { joined: new Map(), signals: [] };
    this.ownJoinSeen = false;
    let result: JoinResult;
    try {
      result = await join();
    } catch (e) {
      this.early = null;
      throw e;
    }
    if (this.closed) return result;
    this.iceServers = result.iceServers || this.iceServers;
    for (const p of [...this.peers.values()]) this.closePeer(p);
    this.peers.clear();
    this.offerToAll(result);
    return result;
  }

  /** My own `call_participant_joined` arrived (or, for a call I started, the start answer did). */
  markOwnJoin() {
    this.ownJoinSeen = true;
  }

  private offerToAll(result: JoinResult) {
    const listed = new Set<number>();
    for (const r of result.participants || []) {
      if (r.userId === this.deps.myUserId) continue;
      listed.add(r.userId);
      const old = this.peers.get(r.userId);
      if (old) this.closePeer(old);
      const p = this.newPeer(r.userId, r.userName, true);
      p.sharing = !!r.isSharingScreen;
    }
    // Someone who joined after me (their event came before my join answer) offers to me: wait for it.
    const early = this.early;
    this.early = null;
    for (const [id, name] of early?.joined || [])
      if (!listed.has(id) && id !== this.deps.myUserId) this.newPeer(id, name, false);
    this.changed();
    for (const [from, data] of early?.signals || []) this.handleSignal(from, data);
  }

  /** Closes every peer and stops every local track (the mic light goes off). Idempotent. The caller tells the server. */
  leave() {
    if (this.closed && !this.mic && !this.peers.size && !this.screen) return;
    this.closed = true;
    this.early = null;
    for (const p of this.peers.values()) this.closePeer(p);
    this.peers.clear();
    if (this.screen) {
      const s = this.screen;
      this.screen = null;
      s.track.onended = null;
      for (const t of s.stream.getTracks()) this.safe('stop screen', () => t.stop());
    }
    this.stopLocal();
    this.changed();
  }

  get isClosed() {
    return this.closed;
  }

  // ---- participants -------------------------------------------------------

  /**
   * `call_participant_joined` for someone else. A new person gets a peer that waits for their offer.
   * A person I already hold: a stale event (their join is older than mine, see `ownJoinSeen`) leaves
   * my offering peer alone; a genuine re-join (from another tab / after a reconnect) rebuilds it.
   */
  addParticipant(userId: number, userName: string) {
    if (this.closed || userId === this.deps.myUserId) return;
    if (this.early) {
      this.early.joined.set(userId, userName);
      return;
    }
    const old = this.peers.get(userId);
    if (old && old.initiator && old.state !== 'lost' && !this.ownJoinSeen) return;
    if (old) this.closePeer(old);
    this.newPeer(userId, userName || old?.userName || '', false);
    this.changed();
  }

  /** `call_participant_left`: only that peer goes. */
  removeParticipant(userId: number) {
    this.early?.joined.delete(userId);
    const p = this.peers.get(userId);
    if (!p) return;
    this.closePeer(p);
    this.peers.delete(userId);
    this.changed();
  }

  /** `call_screen_share_started|stopped` for someone else. */
  setRemoteSharing(userId: number, on: boolean) {
    const p = this.peers.get(userId);
    if (!p) return;
    p.sharing = on;
    if (!on) p.videoLive = false;
    else if (p.videoTrack && !p.videoTrack.muted) p.videoLive = true;
    this.changed();
  }

  // ---- signalling ---------------------------------------------------------

  /** `webrtc_signal` from another participant. Unknown or lost senders are ignored; errors stay with that peer. */
  handleSignal(fromUserId: number, data: Signal) {
    if (this.closed || !data || typeof data !== 'object') return;
    if (this.early) {
      if (this.early.signals.length < 500) this.early.signals.push([Number(fromUserId), data]);
      return;
    }
    const p = this.peers.get(Number(fromUserId));
    if (!p) return;
    if (data.type === 'state') {
      p.muted = !!data.muted;
      this.changed();
      return;
    }
    this.onSignal(p, data).catch((e) => this.log(`signal from ${p.userId}`, e));
  }

  private async onSignal(p: Peer, data: Signal) {
    const pc = p.pc;
    if (!pc) return;
    if (data.type === 'description') {
      const description = data.description;
      const offerCollision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
      p.ignoreOffer = !p.polite && offerCollision;
      if (p.ignoreOffer) return;
      if (offerCollision) {
        // Polite: let my own offer finish being made, then roll it back.
        if (p.offering) await p.offering.catch(() => {});
        if (p.pc !== pc) return;
        if (pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' });
      }
      await pc.setRemoteDescription(description);
      if (p.pc !== pc) return;
      await this.flushCandidates(p, pc);
      if (description.type === 'offer') {
        const first = !p.ready;
        p.ready = true;
        this.clearTimer(p, 'waitTimer');
        await pc.setLocalDescription();
        if (p.pc === pc && pc.localDescription)
          this.send(p, { type: 'description', description: plainDesc(pc.localDescription) });
        if (first && p.pc === pc) this.addScreenTo(p);
      }
    } else if (data.type === 'candidate') {
      if (!pc.remoteDescription) {
        p.pending.push(data.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (e) {
        if (!p.ignoreOffer) throw e;
      }
    }
  }

  private async flushCandidates(p: Peer, pc: PeerLike) {
    const queued = p.pending;
    p.pending = [];
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch (e) {
        this.log(`queued candidate for ${p.userId}`, e);
      }
    }
  }

  // ---- local media --------------------------------------------------------

  setMuted(muted: boolean) {
    this.muted = muted;
    for (const t of this.mic?.getAudioTracks() || [])
      this.safe('mute', () => {
        t.enabled = !muted;
      });
    for (const p of this.peers.values()) if (p.pc) this.send(p, { type: 'state', muted });
    this.changed();
  }

  /** Capture the screen, tell the server, then send it to every peer. The call is never affected by a failure here. */
  async startShare(): Promise<ShareResult> {
    if (this.closed) return { ok: false, reason: 'not_in_call', message: 'You are not in a call' };
    if (this.screen || this.sharePending) return { ok: true };
    this.sharePending = true;
    try {
      let stream: StreamLike;
      try {
        stream = await this.deps.getDisplay();
      } catch {
        return { ok: false, reason: 'cancelled', message: 'Screen sharing was cancelled' };
      }
      const track = stream.getVideoTracks()[0];
      const stopAll = () => {
        for (const t of stream.getTracks()) this.safe('stop capture', () => t.stop());
      };
      if (!track) {
        stopAll();
        return { ok: false, reason: 'failed', message: 'No screen was captured' };
      }
      try {
        await this.deps.announceShare(true);
      } catch (e: any) {
        stopAll();
        if (e?.code === 'already_sharing') return { ok: false, reason: 'busy', message: SHARE_BUSY_MESSAGE };
        return { ok: false, reason: 'failed', message: e?.message || 'Could not share your screen' };
      }
      if (this.closed) {
        stopAll();
        this.deps.announceShare(false).catch(() => {});
        return { ok: false, reason: 'not_in_call', message: 'You are not in a call' };
      }
      this.screen = { stream, track };
      track.onended = () => this.stopShare(); // the browser's own "Stop sharing" button
      for (const p of this.peers.values()) this.addScreenTo(p);
      this.changed();
      return { ok: true };
    } finally {
      this.sharePending = false;
    }
  }

  stopShare() {
    const s = this.screen;
    if (!s) return;
    this.screen = null;
    s.track.onended = null;
    for (const p of this.peers.values()) this.removeScreenFrom(p);
    for (const t of s.stream.getTracks()) this.safe('stop screen', () => t.stop());
    this.deps.announceShare(false).catch((e) => this.log('announce share off', e));
    this.changed();
  }

  snapshot(): CallSnapshot {
    return {
      muted: this.muted,
      sharing: !!this.screen,
      ownScreenTrack: this.screen?.track ?? null,
      ownAudioTrack: this.mic?.getAudioTracks()[0] ?? null,
      participants: [...this.peers.values()].map((p) => ({
        userId: p.userId,
        userName: p.userName,
        state: p.state,
        muted: p.muted,
        sharing: p.sharing,
        audioTrack: p.audioTrack,
        screenTrack: p.videoLive ? p.videoTrack : null,
      })),
    };
  }

  // ---- per peer -----------------------------------------------------------

  private newPeer(userId: number, userName: string, initiator: boolean): Peer {
    const p: Peer = {
      userId,
      userName,
      pc: null,
      polite: this.deps.myUserId > userId,
      initiator,
      ready: initiator,
      makingOffer: false,
      offering: null,
      ignoreOffer: false,
      pending: [],
      restartTried: false,
      lostTimer: null,
      connectTimer: null,
      waitTimer: null,
      state: 'connecting',
      muted: false,
      sharing: false,
      audioTrack: null,
      videoTrack: null,
      videoLive: false,
      screenTx: null,
    };
    this.peers.set(userId, p);
    let pc: PeerLike;
    try {
      pc = this.deps.createPeer(this.iceServers, userId);
    } catch (e) {
      this.log(`create peer ${userId}`, e);
      p.state = 'lost';
      return p;
    }
    p.pc = pc;
    try {
      pc.onnegotiationneeded = () => this.negotiate(p, pc);
      pc.onicecandidate = (ev: any) => {
        if (p.pc !== pc || !ev?.candidate) return;
        const c = ev.candidate;
        this.send(p, { type: 'candidate', candidate: typeof c.toJSON === 'function' ? c.toJSON() : c });
      };
      pc.ontrack = (ev: any) => {
        if (p.pc === pc) this.onTrack(p, ev.track);
      };
      pc.onconnectionstatechange = () => {
        if (p.pc === pc) this.onConnState(p, pc);
      };
      for (const t of this.mic?.getAudioTracks() || []) pc.addTrack(t, this.mic!);
      this.addScreenTo(p);
      p.connectTimer = this.timers.setTimeout(() => {
        p.connectTimer = null;
        if (p.pc === pc && pc.connectionState !== 'connected') this.markLost(p);
      }, this.deps.connectTimeoutMs ?? 30_000);
      if (!initiator) {
        // Safety net against both sides waiting: no offer after a few seconds → negotiate myself
        // (perfect negotiation resolves it if their offer crosses mine).
        p.waitTimer = this.timers.setTimeout(() => {
          p.waitTimer = null;
          if (p.pc !== pc || p.ready) return;
          p.ready = true;
          this.addScreenTo(p);
          this.negotiate(p, pc);
        }, this.deps.offerWaitMs ?? 4_000);
      }
    } catch (e) {
      this.log(`set up peer ${userId}`, e);
      this.markLost(p);
    }
    return p;
  }

  private negotiate(p: Peer, pc: PeerLike) {
    if (p.pc !== pc || !p.ready || p.makingOffer) return;
    p.makingOffer = true;
    p.offering = (async () => {
      try {
        await pc.setLocalDescription();
        if (p.pc === pc && pc.localDescription)
          this.send(p, { type: 'description', description: plainDesc(pc.localDescription) });
      } catch (e) {
        this.log(`offer to ${p.userId}`, e);
      } finally {
        p.makingOffer = false;
        p.offering = null;
      }
    })();
  }

  /** Audio = their voice; video = their shared screen, live while not muted/ended (a failed share-off request cannot leave a frozen frame). */
  private onTrack(p: Peer, track: TrackLike) {
    if (track.kind !== 'video') {
      p.audioTrack = track;
      this.changed();
      return;
    }
    p.videoTrack = track;
    p.videoLive = track.muted !== true;
    track.onmute = () => {
      if (p.videoTrack === track && p.videoLive) {
        p.videoLive = false;
        this.changed();
      }
    };
    track.onunmute = () => {
      if (p.videoTrack === track && !p.videoLive) {
        p.videoLive = true;
        this.changed();
      }
    };
    track.onended = () => {
      if (p.videoTrack === track) {
        p.videoTrack = null;
        p.videoLive = false;
        this.changed();
      }
    };
    this.changed();
  }

  /** Sends my screen to this peer on its one video transceiver (reused, or created the first time). */
  private addScreenTo(p: Peer) {
    const s = this.screen;
    const pc = p.pc;
    if (!s || !pc || !p.ready || p.screenTx) return;
    try {
      const tr = pc.getTransceivers().find((t) => !t.stopped && t.receiver?.track?.kind === 'video');
      if (tr) {
        tr.direction = 'sendrecv';
        p.screenTx = tr;
        tr.sender.replaceTrack(s.track).catch((e) => this.log(`share screen with ${p.userId}`, e));
      } else {
        p.screenTx = pc.addTransceiver(s.track, { direction: 'sendrecv', streams: [s.stream] });
      }
    } catch (e) {
      this.log(`share screen with ${p.userId}`, e);
    }
  }

  private removeScreenFrom(p: Peer) {
    const tr = p.screenTx;
    p.screenTx = null;
    if (!tr || !p.pc) return;
    try {
      tr.direction = 'recvonly';
      tr.sender.replaceTrack(null).catch((e) => this.log(`unshare screen with ${p.userId}`, e));
    } catch (e) {
      this.log(`unshare screen with ${p.userId}`, e);
    }
  }

  private onConnState(p: Peer, pc: PeerLike) {
    const st = pc.connectionState;
    if (st === 'connected') {
      this.clearTimer(p, 'lostTimer');
      this.clearTimer(p, 'connectTimer');
      p.restartTried = false;
      if (p.state !== 'connected') {
        p.state = 'connected';
        this.send(p, { type: 'state', muted: this.muted });
        this.changed();
      }
      return;
    }
    if (st === 'disconnected' || st === 'failed') {
      if (!p.restartTried) {
        p.restartTried = true;
        this.safe(`ICE restart ${p.userId}`, () => pc.restartIce());
      }
      if (!p.lostTimer) {
        p.lostTimer = this.timers.setTimeout(() => {
          p.lostTimer = null;
          if (p.pc === pc && pc.connectionState !== 'connected') this.markLost(p);
        }, this.deps.lostAfterMs ?? 10_000);
      }
      if (p.state === 'connected') {
        p.state = 'connecting';
        this.changed();
      }
    }
  }

  private markLost(p: Peer) {
    this.closePeer(p);
    p.state = 'lost';
    this.changed();
  }

  private closePeer(p: Peer) {
    this.clearTimer(p, 'lostTimer');
    this.clearTimer(p, 'connectTimer');
    this.clearTimer(p, 'waitTimer');
    const pc = p.pc;
    p.pc = null;
    p.screenTx = null;
    p.audioTrack = null;
    p.videoTrack = null;
    p.videoLive = false;
    p.pending = [];
    if (!pc) return;
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    this.safe(`close peer ${p.userId}`, () => pc.close());
  }

  private clearTimer(p: Peer, key: TimerKey) {
    if (p[key]) {
      const h = p[key];
      p[key] = null;
      this.safe('clear timer', () => this.timers.clearTimeout(h));
    }
  }

  private send(p: Peer, data: Signal) {
    this.safe(`signal to ${p.userId}`, () => this.deps.sendSignal(p.userId, data));
  }

  private stopLocal() {
    for (const t of this.mic?.getTracks() || []) this.safe('stop mic', () => t.stop());
    this.mic = null;
  }

  private safe(what: string, fn: () => void) {
    try {
      fn();
    } catch (e) {
      this.log(what, e);
    }
  }

  private log(what: string, e?: unknown) {
    try {
      (this.deps.log ?? ((w, err) => console.warn(`[call] ${w}`, (err as any)?.message || err)))(what, e);
    } catch {
      /* never */
    }
  }

  private changed() {
    try {
      this.deps.onChange(this.snapshot());
    } catch (e) {
      this.log('onChange', e);
    }
  }
}

/** RTCSessionDescription → plain JSON for the socket. */
function plainDesc(d: SessionDesc): SessionDesc {
  return { type: d.type, sdp: d.sdp };
}
