import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallManager, CallError, MIC_MESSAGE, type Signal } from '../src/services/callManager.ts';

// ---- fakes ---------------------------------------------------------------
class FakeTrack {
  kind: string;
  enabled = true;
  stopped = false;
  muted = false;
  onended: (() => void) | null = null;
  onmute: (() => void) | null = null;
  onunmute: (() => void) | null = null;
  constructor(kind: string) {
    this.kind = kind;
  }
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[]) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}
type Desc = { type: string; sdp?: string; video?: boolean };
class FakeSender {
  track: FakeTrack | null;
  constructor(track: FakeTrack | null) {
    this.track = track;
  }
  async replaceTrack(t: FakeTrack | null) {
    this.track = t;
  }
}
class FakeTransceiver {
  peer: FakePeer;
  kind: string;
  sender: FakeSender;
  receiver: { track: FakeTrack };
  stopped = false;
  private dir: string;
  constructor(peer: FakePeer, kind: string, direction: string, track: FakeTrack | null) {
    this.peer = peer;
    this.kind = kind;
    this.dir = direction;
    this.sender = new FakeSender(track);
    this.receiver = { track: new FakeTrack(kind) };
  }
  get direction() {
    return this.dir;
  }
  set direction(d: string) {
    if (d !== this.dir) {
      this.dir = d;
      this.peer.needNeg();
    }
  }
}
class FakePeer {
  remote: number;
  signalingState = 'stable';
  connectionState = 'new';
  localDescription: Desc | null = null;
  remoteDescription: Desc | null = null;
  onnegotiationneeded: (() => any) | null = null;
  onicecandidate: ((e: any) => any) | null = null;
  ontrack: ((e: any) => any) | null = null;
  onconnectionstatechange: (() => any) | null = null;
  transceivers: FakeTransceiver[] = [];
  candidates: any[] = [];
  restarts = 0;
  closed = false;
  rollbacks = 0;
  srdCalls = 0;
  failAddTrack = false;
  failTransceivers = false;
  failCandidates = false;
  holdLocal: Promise<void> | null = null;
  private negQueued = false;
  constructor(remote: number) {
    this.remote = remote;
  }
  get senders() {
    return this.transceivers.map((t) => t.sender);
  }
  videoTransceivers() {
    return this.transceivers.filter((t) => t.kind === 'video');
  }
  addTrack(track: FakeTrack) {
    if (this.failAddTrack) throw new Error('boom');
    const t = new FakeTransceiver(this, track.kind, 'sendrecv', track);
    this.transceivers.push(t);
    this.needNeg();
    return t.sender;
  }
  addTransceiver(trackOrKind: FakeTrack | string, init?: { direction?: string }) {
    if (this.failTransceivers) throw new Error('boom');
    const track = typeof trackOrKind === 'string' ? null : trackOrKind;
    const kind = typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind;
    const t = new FakeTransceiver(this, kind, init?.direction ?? 'sendrecv', track);
    this.transceivers.push(t);
    this.needNeg();
    return t;
  }
  getTransceivers() {
    if (this.failTransceivers) throw new Error('boom');
    return this.transceivers;
  }
  // Like the browser: several changes in one task give one negotiationneeded, and only in stable.
  needNeg() {
    if (this.negQueued) return;
    this.negQueued = true;
    queueMicrotask(() => {
      this.negQueued = false;
      if (this.signalingState === 'stable' && !this.closed) this.onnegotiationneeded?.();
    });
  }
  async setLocalDescription(d?: Desc) {
    if (d?.type === 'rollback') {
      if (this.signalingState === 'stable') throw new Error('InvalidStateError: rollback in stable');
      this.rollbacks++;
      this.signalingState = 'stable';
      this.localDescription = null;
      return;
    }
    if (this.holdLocal) await this.holdLocal;
    if (this.signalingState === 'have-remote-offer') {
      this.localDescription = { type: 'answer', sdp: 'a' };
      this.signalingState = 'stable';
    } else {
      this.localDescription = { type: 'offer', sdp: 'o' };
      this.signalingState = 'have-local-offer';
    }
  }
  async setRemoteDescription(d: Desc) {
    this.srdCalls++;
    if (d.type === 'offer' && this.signalingState === 'have-local-offer')
      throw new Error('InvalidStateError: offer in have-local-offer');
    this.remoteDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
    if (d.type === 'offer' && d.video && !this.transceivers.some((t) => t.kind === 'video'))
      this.transceivers.push(new FakeTransceiver(this, 'video', 'recvonly', null));
  }
  async addIceCandidate(c: any) {
    if (this.failCandidates) throw new Error('bad candidate');
    this.candidates.push(c);
  }
  restartIce() {
    this.restarts++;
    this.needNeg();
  }
  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }
  setConn(s: string) {
    this.connectionState = s;
    this.onconnectionstatechange?.();
  }
}
function fakeTimers() {
  let seq = 0;
  const pending = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const id = ++seq;
      pending.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id: any) => {
      pending.delete(id);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending])
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const ICE = [{ urls: 'stun:x' }];
const people = (...ids: number[]) => ids.map((id) => ({ userId: id, userName: `U${id}`, isSharingScreen: false }));

function setup(
  opts: {
    me?: number;
    getMic?: () => Promise<any>;
    getDisplay?: () => Promise<any>;
    sendSignal?: (to: number, d: Signal) => void;
    announceShare?: (on: boolean) => Promise<void>;
    peerInit?: (p: FakePeer) => void;
  } = {},
) {
  const logs: string[] = [];
  const peers: FakePeer[] = [];
  const sent: Array<{ to: number; data: Signal }> = [];
  const timers = fakeTimers();
  const micTrack = new FakeTrack('audio');
  const mic = new FakeStream([micTrack]);
  const screens: FakeTrack[] = [];
  const announced: boolean[] = [];
  const mgr = new CallManager({
    myUserId: opts.me ?? 5,
    createPeer: (_ice: unknown, remote: number) => {
      const p = new FakePeer(remote);
      opts.peerInit?.(p);
      peers.push(p);
      return p as any;
    },
    getMic: opts.getMic ?? (async () => mic as any),
    getDisplay:
      opts.getDisplay ??
      (async () => {
        const t = new FakeTrack('video');
        screens.push(t);
        return new FakeStream([t]) as any;
      }),
    sendSignal:
      opts.sendSignal ??
      ((to, data) => {
        sent.push({ to, data });
      }),
    announceShare:
      opts.announceShare ??
      (async (on) => {
        announced.push(on);
      }),
    onChange: () => {},
    timers,
    log: (what: string) => {
      logs.push(what);
    },
  });
  const peerOf = (id: number) => peers.filter((p) => p.remote === id).at(-1)!;
  const stateOf = (id: number) => mgr.snapshot().participants.find((p) => p.userId === id);
  return { mgr, peers, sent, timers, mic, micTrack, screens, announced, peerOf, stateOf, logs };
}
const answerAll = async (peers: FakePeer[]) => {
  for (const p of peers)
    if (!p.closed && p.signalingState === 'have-local-offer') await p.setRemoteDescription({ type: 'answer' });
};
const offersTo = (sent: Array<{ to: number; data: Signal }>, to: number) =>
  sent.filter((s) => s.to === to && s.data.type === 'description' && (s.data as any).description.type === 'offer');

// ---- tests ---------------------------------------------------------------
test('the joiner sends an offer to each existing participant and none to itself', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5, 9), iceServers: ICE }));
  await flush();
  assert.equal(offersTo(h.sent, 2).length, 1);
  assert.equal(offersTo(h.sent, 9).length, 1);
  assert.equal(h.sent.filter((s) => s.to === 5).length, 0);
  assert.equal(h.peers.length, 2);
  assert.equal(h.peerOf(2).senders[0]!.track, h.micTrack, 'the microphone is sent to each peer');
});

test('an existing participant waits, then answers an incoming offer', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(5), iceServers: ICE }));
  h.mgr.addParticipant(7, 'U7');
  await flush();
  assert.equal(offersTo(h.sent, 7).length, 0, 'existing participants do not offer');
  h.mgr.handleSignal(7, { type: 'description', description: { type: 'offer', sdp: 'x' } });
  await flush();
  const answers = h.sent.filter(
    (s) => s.to === 7 && s.data.type === 'description' && (s.data as any).description.type === 'answer',
  );
  assert.equal(answers.length, 1);
});

test('ICE candidates are queued until the remote description is set', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(5), iceServers: ICE }));
  h.mgr.addParticipant(7, 'U7');
  h.mgr.handleSignal(7, { type: 'candidate', candidate: { candidate: 'c1' } });
  await flush();
  assert.equal(h.peerOf(7).candidates.length, 0);
  h.mgr.handleSignal(7, { type: 'description', description: { type: 'offer', sdp: 'x' } });
  await flush();
  assert.deepEqual(h.peerOf(7).candidates, [{ candidate: 'c1' }]);
  h.mgr.handleSignal(7, { type: 'candidate', candidate: { candidate: 'c2' } });
  await flush();
  assert.equal(h.peerOf(7).candidates.length, 2);
});

test('offer collision: the impolite peer (smaller id) ignores, the polite peer (larger id) rolls back', async () => {
  // me = 5, remote 9: I am impolite.
  const a = setup({ me: 5 });
  await a.mgr.connect(async () => ({ participants: people(5, 9), iceServers: ICE }));
  await flush();
  assert.equal(a.peerOf(9).signalingState, 'have-local-offer');
  a.mgr.handleSignal(9, { type: 'description', description: { type: 'offer', sdp: 'theirs' } });
  await flush();
  const srd = a.peerOf(9).srdCalls;
  assert.equal(a.peerOf(9).remoteDescription, null, 'impolite ignores the colliding offer');
  assert.equal(a.peerOf(9).rollbacks, 0);
  assert.equal(srd, 0, 'setRemoteDescription is not attempted for an ignored offer');

  // me = 9, remote 5: I am polite.
  const b = setup({ me: 9 });
  await b.mgr.connect(async () => ({ participants: people(5, 9), iceServers: ICE }));
  await flush();
  assert.equal(b.peerOf(5).signalingState, 'have-local-offer');
  b.mgr.handleSignal(5, { type: 'description', description: { type: 'offer', sdp: 'theirs' } });
  await flush();
  assert.equal(b.peerOf(5).rollbacks, 1);
  assert.equal(b.peerOf(5).remoteDescription?.sdp, 'theirs');
  assert.ok(
    b.sent.some((s) => s.to === 5 && (s.data as any).description?.type === 'answer'),
    'polite answers',
  );
});

test('a signal from an unknown user is ignored', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(5, 2), iceServers: ICE }));
  await flush();
  const before = h.peers.length;
  h.mgr.handleSignal(42, { type: 'description', description: { type: 'offer', sdp: 'x' } });
  await flush();
  assert.equal(h.peers.length, before);
  assert.equal(h.sent.filter((s) => s.to === 42).length, 0);
});

test('participant joined adds a peer and participant left removes only that peer', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  h.mgr.addParticipant(7, 'U7');
  await flush();
  assert.deepEqual(
    h.mgr
      .snapshot()
      .participants.map((p) => p.userId)
      .sort(),
    [2, 7],
  );
  const p2 = h.peerOf(2);
  h.mgr.removeParticipant(7);
  assert.equal(h.peerOf(7).closed, true);
  assert.equal(p2.closed, false);
  assert.deepEqual(
    h.mgr.snapshot().participants.map((p) => p.userId),
    [2],
  );
});

test('a re-join of a known peer rebuilds only that peer', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5, 7), iceServers: ICE }));
  await flush();
  const old7 = h.peerOf(7);
  const p2 = h.peerOf(2);
  h.mgr.markOwnJoin();
  h.mgr.addParticipant(7, 'U7');
  await flush();
  assert.equal(old7.closed, true);
  assert.notEqual(h.peerOf(7), old7);
  assert.equal(h.peerOf(7).closed, false);
  assert.equal(p2.closed, false);
  assert.equal(h.peers.filter((p) => p.remote === 2).length, 1, 'peer 2 untouched');
});

test('one failing peer: one ICE restart, then only that peer is closed and marked lost', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5, 7), iceServers: ICE }));
  await flush();
  h.peerOf(2).setConn('connected');
  h.peerOf(7).setConn('connected');
  assert.equal(h.stateOf(7)!.state, 'connected');
  h.peerOf(7).setConn('failed');
  h.peerOf(7).setConn('failed');
  assert.equal(h.peerOf(7).restarts, 1, 'exactly one ICE restart');
  h.timers.advance(10_000);
  assert.equal(h.peerOf(7).closed, true);
  assert.equal(h.stateOf(7)!.state, 'lost');
  assert.equal(h.peerOf(2).closed, false);
  assert.equal(h.stateOf(2)!.state, 'connected');
  assert.equal(h.micTrack.stopped, false, 'local stream kept');
});

test('a peer that recovers after the ICE restart is kept', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  await flush();
  h.peerOf(2).setConn('connected');
  h.peerOf(2).setConn('disconnected');
  h.peerOf(2).setConn('connected');
  h.timers.advance(10_000);
  assert.equal(h.peerOf(2).closed, false);
  assert.equal(h.stateOf(2)!.state, 'connected');
});

test('screen share adds a video track to every peer; stopping removes it and tells the server', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5, 7), iceServers: ICE }));
  await flush();
  for (const p of [h.peerOf(2), h.peerOf(7)]) {
    await p.setRemoteDescription({ type: 'answer' });
  }
  const before = h.sent.length;
  const r = await h.mgr.startShare();
  assert.equal(r.ok, true);
  await flush();
  assert.deepEqual(h.announced, [true]);
  for (const id of [2, 7])
    assert.ok(
      h.peerOf(id).senders.some((s) => s.track?.kind === 'video'),
      `video to ${id}`,
    );
  assert.equal(
    h.sent.slice(before).filter((s) => (s.data as any).description?.type === 'offer').length,
    2,
    'renegotiated with each',
  );
  assert.equal(h.mgr.snapshot().sharing, true);
  for (const p of [h.peerOf(2), h.peerOf(7)]) {
    await p.setRemoteDescription({ type: 'answer' });
  }
  const mid = h.sent.length;
  h.mgr.stopShare();
  await flush();
  for (const id of [2, 7]) assert.ok(!h.peerOf(id).senders.some((s) => s.track?.kind === 'video'));
  assert.equal(h.screens[0]!.stopped, true);
  assert.deepEqual(h.announced, [true, false]);
  assert.equal(
    h.sent.slice(mid).filter((s) => (s.data as any).description?.type === 'offer').length,
    2,
    'renegotiated after removal',
  );
});

test('the browser "Stop sharing" button (track ended) stops the share', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  await h.mgr.startShare();
  h.screens[0]!.onended?.();
  assert.equal(h.mgr.snapshot().sharing, false);
  assert.deepEqual(h.announced, [true, false]);
});

test('a share refused by the server stops the captured track and adds nothing', async () => {
  const h = setup({
    me: 5,
    announceShare: async () => {
      throw Object.assign(new Error('busy'), { code: 'already_sharing' });
    },
  });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  const r = await h.mgr.startShare();
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.message, 'Someone is already sharing');
  assert.equal(h.screens[0]!.stopped, true);
  assert.ok(!h.peerOf(2).senders.some((s) => s.track?.kind === 'video'));
  assert.equal(h.mgr.snapshot().sharing, false);
});

test('getDisplayMedia rejecting leaves the call intact', async () => {
  const h = setup({
    me: 5,
    getDisplay: async () => {
      throw new Error('NotAllowedError');
    },
  });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  await flush();
  const r = await h.mgr.startShare();
  assert.equal(r.ok, false);
  assert.deepEqual(h.announced, []);
  assert.equal(h.peerOf(2).closed, false);
  assert.equal(h.micTrack.stopped, false);
});

test("a remote video track is that person's shared screen", async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  const v = new FakeTrack('video');
  const a = new FakeTrack('audio');
  h.peerOf(2).ontrack?.({ track: a, streams: [] });
  h.peerOf(2).ontrack?.({ track: v, streams: [] });
  assert.equal(h.stateOf(2)!.audioTrack, a);
  assert.equal(h.stateOf(2)!.screenTrack, v);
  h.mgr.setRemoteSharing(2, false);
  assert.equal(h.stateOf(2)!.screenTrack, null);
});

test('microphone rejected: join is not attempted and a clean error is thrown', async () => {
  let joined = false;
  const h = setup({
    getMic: async () => {
      throw new Error('NotAllowedError');
    },
  });
  await assert.rejects(
    h.mgr.connect(async () => {
      joined = true;
      return { participants: people(5), iceServers: ICE };
    }),
    (e: any) => e instanceof CallError && e.code === 'mic' && e.message === MIC_MESSAGE,
  );
  assert.equal(joined, false);
  assert.equal(h.peers.length, 0);
});

test('leaving while the microphone prompt is pending: start/join is never called and the mic is stopped', async () => {
  let joined = false;
  let give!: (s: any) => void;
  const track = new FakeTrack('audio');
  const h = setup({
    getMic: () =>
      new Promise((r) => {
        give = r;
      }),
  });
  const p = h.mgr.connect(async () => {
    joined = true;
    return { participants: people(5), iceServers: ICE };
  });
  h.mgr.leave();
  give(new FakeStream([track]));
  await assert.rejects(p, (e: any) => e instanceof CallError && e.code === 'left');
  assert.equal(joined, false);
  assert.equal(track.stopped, true);
});

test('closed while the join request is in flight: the mic is stopped', async () => {
  const h = setup();
  const p = h.mgr.connect(async () => {
    h.mgr.leave();
    return { participants: people(2, 5), iceServers: ICE };
  });
  await assert.rejects(p, (e: any) => e instanceof CallError && e.code === 'left');
  assert.equal(h.micTrack.stopped, true);
  assert.equal(h.peers.length, 0);
});

test('a failing join releases the microphone', async () => {
  const h = setup();
  await assert.rejects(
    h.mgr.connect(async () => {
      throw new Error('call_full');
    }),
  );
  assert.equal(h.micTrack.stopped, true);
});

test('leave closes all peers and stops every local track', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5, 7), iceServers: ICE }));
  await h.mgr.startShare();
  h.mgr.leave();
  assert.ok(h.peers.every((p) => p.closed));
  assert.equal(h.micTrack.stopped, true);
  assert.equal(h.screens[0]!.stopped, true);
  assert.deepEqual(h.mgr.snapshot().participants, []);
});

test('mute disables the local audio track without renegotiating and tells the peers', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  await flush();
  const offers = offersTo(h.sent, 2).length;
  h.mgr.setMuted(true);
  await flush();
  assert.equal(h.micTrack.enabled, false);
  assert.equal(offersTo(h.sent, 2).length, offers);
  assert.ok(h.sent.some((s) => s.to === 2 && s.data.type === 'state' && (s.data as any).muted === true));
  h.mgr.handleSignal(2, { type: 'state', muted: true });
  assert.equal(h.stateOf(2)!.muted, true);
});

test('a throwing sendSignal for one peer does not stop the others', async () => {
  const sent: number[] = [];
  const h = setup({
    me: 5,
    sendSignal: (to) => {
      if (to === 2) throw new Error('socket gone');
      sent.push(to);
    },
  });
  await h.mgr.connect(async () => ({ participants: people(2, 5, 7, 9), iceServers: ICE }));
  await flush();
  assert.ok(sent.includes(7) && sent.includes(9));
  h.mgr.setMuted(true);
  assert.equal(sent.filter((t) => t === 9).length >= 2, true);
});

test('a participant who joins, and their offer, arriving before my join response are applied after it', async () => {
  const h = setup({ me: 5 });
  let release!: (r: any) => void;
  const done = h.mgr.connect(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  await flush();
  h.mgr.addParticipant(8, 'U8');
  h.mgr.handleSignal(8, { type: 'description', description: { type: 'offer', sdp: 'x' } });
  assert.equal(h.peers.length, 0, 'nothing is built before the join answer');
  release({ participants: people(2, 5), iceServers: ICE });
  await done;
  await flush();
  assert.equal(offersTo(h.sent, 2).length, 1);
  assert.equal(offersTo(h.sent, 8).length, 0, 'the later joiner offers, not me');
  assert.ok(h.sent.some((s) => s.to === 8 && (s.data as any).description?.type === 'answer'));
});

test('a throwing peer method for one peer does not stop the others', async () => {
  const peers: FakePeer[] = [];
  const sent: number[] = [];
  const mgr = new CallManager({
    myUserId: 5,
    onChange: () => {},
    timers: fakeTimers(),
    createPeer: (_i: unknown, remote: number) => {
      const p = new FakePeer(remote);
      if (remote === 2) p.failAddTrack = true;
      peers.push(p);
      return p as any;
    },
    getMic: async () => new FakeStream([new FakeTrack('audio')]) as any,
    getDisplay: async () => new FakeStream([new FakeTrack('video')]) as any,
    sendSignal: (to) => {
      sent.push(to);
    },
    announceShare: async () => {},
  });
  await mgr.connect(async () => ({ participants: people(2, 5, 7, 9), iceServers: ICE }));
  await flush();
  assert.ok(sent.includes(7));
  assert.equal(peers.find((p) => p.remote === 7)!.closed, false);
  // a throwing peer method inside a loop over peers (share) must not stop the others
  const p7 = peers.find((p) => p.remote === 7)!;
  const p9 = peers.find((p) => p.remote === 9)!;
  p7.failTransceivers = true;
  const r = await mgr.startShare();
  assert.equal(r.ok, true);
  assert.ok(
    p9.senders.some((s) => s.track?.kind === 'video'),
    'peer 9 still gets the screen',
  );
  assert.equal(p7.closed, false);
  // a signalling handler throwing for one peer
  p7.setRemoteDescription = async () => {
    throw new Error('bad sdp');
  };
  mgr.handleSignal(7, { type: 'description', description: { type: 'answer', sdp: 'x' } });
  mgr.handleSignal(9, { type: 'description', description: { type: 'answer', sdp: 'y' } });
  await flush();
  assert.equal(p9.remoteDescription?.sdp, 'y');
  mgr.handleSignal(2, { type: 'state', muted: true });
  await flush();
  assert.equal(mgr.snapshot().participants.find((p) => p.userId === 2)!.muted, true);
});

test('three share start/stop cycles keep exactly one video transceiver per peer', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5, 7), iceServers: ICE }));
  await flush();
  await answerAll(h.peers);
  for (let i = 0; i < 3; i++) {
    assert.equal((await h.mgr.startShare()).ok, true);
    await flush();
    await answerAll(h.peers);
    for (const id of [2, 7])
      assert.equal(h.peerOf(id).videoTransceivers()[0]!.sender.track, h.screens[i], `sharing to ${id}`);
    h.mgr.stopShare();
    await flush();
    await answerAll(h.peers);
    for (const id of [2, 7]) assert.equal(h.peerOf(id).videoTransceivers()[0]!.direction, 'recvonly');
  }
  for (const id of [2, 7]) assert.equal(h.peerOf(id).videoTransceivers().length, 1);
});

test("sharing reuses the video transceiver created by the other side's offer", async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(5), iceServers: ICE }));
  h.mgr.markOwnJoin();
  h.mgr.addParticipant(8, 'U8');
  h.mgr.handleSignal(8, { type: 'description', description: { type: 'offer', sdp: 'x', video: true } as any });
  await flush();
  await h.mgr.startShare();
  await flush();
  assert.equal(h.peerOf(8).videoTransceivers().length, 1);
  assert.equal(h.peerOf(8).videoTransceivers()[0]!.sender.track, h.screens[0]);
  assert.equal(h.peerOf(8).videoTransceivers()[0]!.direction, 'sendrecv');
});

test('a peer that joins while I share gets the screen (their offer, and my own offer after a re-join)', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(5), iceServers: ICE }));
  h.mgr.markOwnJoin();
  await h.mgr.startShare();
  h.mgr.addParticipant(8, 'U8');
  h.mgr.handleSignal(8, { type: 'description', description: { type: 'offer', sdp: 'x' } });
  await flush();
  assert.equal(h.peerOf(8).videoTransceivers().length, 1);
  assert.equal(h.peerOf(8).videoTransceivers()[0]!.sender.track, h.screens[0]);
  await h.mgr.rejoin(async () => ({ participants: people(5, 9), iceServers: ICE }));
  await flush();
  assert.equal(h.peerOf(9).videoTransceivers()[0]!.sender.track, h.screens[0]);
});

test("the remote screen is cleared on the track's mute or ended, and back on unmute", async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  const v = new FakeTrack('video');
  h.peerOf(2).ontrack?.({ track: v, streams: [] });
  assert.equal(h.stateOf(2)!.screenTrack, v);
  v.muted = true;
  v.onmute?.();
  assert.equal(h.stateOf(2)!.screenTrack, null);
  v.muted = false;
  v.onunmute?.();
  assert.equal(h.stateOf(2)!.screenTrack, v);
  v.onended?.();
  assert.equal(h.stateOf(2)!.screenTrack, null);
});

test('a stale participant_joined (a join older than mine) does not replace my offering peer; a genuine re-join does', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5, 7), iceServers: ICE }));
  await flush();
  const first7 = h.peerOf(7);
  h.mgr.addParticipant(7, 'U7'); // their join happened before mine: its event arrives late
  await flush();
  assert.equal(h.peerOf(7), first7);
  assert.equal(first7.closed, false);
  h.mgr.markOwnJoin();
  h.mgr.addParticipant(7, 'U7'); // after my own join event: a real re-join
  assert.equal(first7.closed, true);
  assert.notEqual(h.peerOf(7), first7);
});

test('a waiting peer that gets no offer within 4 s starts negotiating itself', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(5), iceServers: ICE }));
  h.mgr.markOwnJoin();
  h.mgr.addParticipant(8, 'U8');
  await flush();
  assert.equal(offersTo(h.sent, 8).length, 0);
  h.timers.advance(4000);
  await flush();
  assert.equal(offersTo(h.sent, 8).length, 1);
});

test('collision while my offer is still being made (stable, makingOffer): polite waits, rolls back and answers', async () => {
  let release!: () => void;
  const h = setup({
    me: 9,
    peerInit: (p) => {
      p.holdLocal = new Promise((r) => {
        release = r;
      });
    },
  });
  await h.mgr.connect(async () => ({ participants: people(5, 9), iceServers: ICE }));
  await flush();
  assert.equal(h.peerOf(5).signalingState, 'stable');
  h.mgr.handleSignal(5, { type: 'description', description: { type: 'offer', sdp: 'theirs' } });
  await flush();
  h.peerOf(5).holdLocal = null;
  release();
  await flush();
  assert.equal(h.peerOf(5).rollbacks, 1);
  assert.equal(h.peerOf(5).remoteDescription?.sdp, 'theirs');
  assert.ok(h.sent.some((s) => s.to === 5 && (s.data as any).description?.type === 'answer'));
});

test('collision while my offer is still being made: impolite ignores without touching the remote description', async () => {
  let release!: () => void;
  const h = setup({
    me: 5,
    peerInit: (p) => {
      p.holdLocal = new Promise((r) => {
        release = r;
      });
    },
  });
  await h.mgr.connect(async () => ({ participants: people(5, 9), iceServers: ICE }));
  await flush();
  h.mgr.handleSignal(9, { type: 'description', description: { type: 'offer', sdp: 'theirs' } });
  await flush();
  assert.equal(h.peerOf(9).srdCalls, 0);
  h.peerOf(9).holdLocal = null;
  release();
  await flush();
  assert.equal(h.peerOf(9).srdCalls, 0);
});

test('candidates that belong to an ignored offer do not throw or log', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(5, 9), iceServers: ICE }));
  await flush();
  await answerAll(h.peers);
  const p9 = h.peerOf(9);
  await h.mgr.startShare();
  await flush(); // my renegotiation offer is out (have-local-offer)
  assert.equal(p9.signalingState, 'have-local-offer');
  h.mgr.handleSignal(9, { type: 'description', description: { type: 'offer', sdp: 'theirs' } }); // ignored (impolite)
  p9.failCandidates = true;
  h.mgr.handleSignal(9, { type: 'candidate', candidate: { candidate: 'x' } });
  await flush();
  assert.deepEqual(
    h.logs.filter((l) => /signal|candidate/.test(l)),
    [],
  );
});

test('a peer that never connects is marked lost after 30 s; the others stay', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5, 7), iceServers: ICE }));
  await flush();
  h.peerOf(2).setConn('connected');
  h.timers.advance(30_000);
  assert.equal(h.stateOf(7)!.state, 'lost');
  assert.equal(h.peerOf(7).closed, true);
  assert.equal(h.stateOf(2)!.state, 'connected');
});

test('a lost peer stays lost when they send an offer; their re-join rebuilds the pair', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  await flush();
  h.timers.advance(30_000);
  const n = h.peers.length;
  h.mgr.handleSignal(2, { type: 'description', description: { type: 'offer', sdp: 'x' } });
  await flush();
  assert.equal(h.peers.length, n);
  assert.equal(h.stateOf(2)!.state, 'lost');
  h.mgr.markOwnJoin();
  h.mgr.addParticipant(2, 'U2');
  assert.equal(h.stateOf(2)!.state, 'connecting');
});

test('rejoin after a reconnect rebuilds every peer and keeps the microphone', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  await flush();
  const old2 = h.peerOf(2);
  await h.mgr.rejoin(async () => ({ participants: people(2, 5, 7), iceServers: ICE }));
  await flush();
  assert.equal(old2.closed, true);
  assert.notEqual(h.peerOf(2), old2);
  assert.equal(offersTo(h.sent, 2).length, 2);
  assert.equal(offersTo(h.sent, 7).length, 1);
  assert.equal(h.micTrack.stopped, false);
  assert.equal(h.peerOf(2).senders[0]!.track, h.micTrack);
});

test('the sharer gets their own screen back for a preview, and it goes when the share stops', async () => {
  const h = setup({ me: 5 });
  await h.mgr.connect(async () => ({ participants: people(2, 5), iceServers: ICE }));
  assert.equal(h.mgr.snapshot().ownScreenTrack, null);
  await h.mgr.startShare();
  assert.equal(h.mgr.snapshot().ownScreenTrack, h.screens[0]);
  h.mgr.stopShare();
  assert.equal(h.mgr.snapshot().ownScreenTrack, null);
  await h.mgr.startShare();
  assert.equal(h.mgr.snapshot().ownScreenTrack, h.screens[1]);
  h.mgr.leave();
  assert.equal(h.mgr.snapshot().ownScreenTrack, null);
});

test('breakout groups: my microphone goes only to the people in my room, and comes back when the groups close', async () => {
  const { mgr, peerOf, micTrack } = setup({ me: 5 });
  await mgr.connect(async () => ({
    participants: [
      { userId: 1, userName: 'Meg', isSharingScreen: false },
      { userId: 2, userName: 'Ann', isSharingScreen: false },
      { userId: 3, userName: 'Bob', isSharingScreen: false },
    ],
    iceServers: [],
  }));
  const micTo = (id: number) =>
    peerOf(id)
      .transceivers.filter((t) => t.kind === 'audio')
      .map((t) => t.sender.track)[0];
  for (const id of [1, 2, 3]) assert.equal(micTo(id), micTrack, `starts by sending to ${id}`);
  const negotiations = [1, 2, 3].map((id) => peerOf(id).transceivers.length);

  mgr.setRoom([2]); // I am in a group with Ann only
  await Promise.resolve();
  assert.equal(micTo(2), micTrack);
  assert.equal(micTo(1), null, 'the host no longer receives my voice');
  assert.equal(micTo(3), null);

  mgr.setRoom([2, 3]); // Bob is moved into my group
  await Promise.resolve();
  assert.equal(micTo(3), micTrack);
  assert.equal(micTo(1), null);

  // Someone who joins while the groups are open is outside my room until the host puts them in it.
  mgr.addParticipant(5, 'Me'); // my own join event
  mgr.addParticipant(9, 'Cy');
  await Promise.resolve();
  assert.equal(micTo(9), null);

  mgr.setRoom(null); // everyone is brought back
  await Promise.resolve();
  for (const id of [1, 2, 3, 9]) assert.equal(micTo(id), micTrack, `sending to ${id} again`);
  assert.deepEqual(
    [1, 2, 3].map((id) => peerOf(id).transceivers.length),
    negotiations,
    'nothing was added to the connections: the track was only swapped',
  );
});
