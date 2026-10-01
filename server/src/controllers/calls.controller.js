import { httpError, sendError, wrap } from '../middleware/errors.js';
import { buildIceServers } from '../services/calls/ice.js';

/** The call service makes every decision; these handlers only shape the HTTP answer. */
export function createCallController({ calls, config = {} }) {
  const service = () => {
    if (!calls) throw httpError(503, 'unavailable', 'Calls are not available');
    return calls;
  };

  return {
    iceServers: wrap(async (req, res) => {
      const iceServers = calls?.iceServersFor
        ? calls.iceServersFor(req.user.id)
        : buildIceServers({ config, userId: req.user.id });
      res.json({ success: true, iceServers });
    }),

    /** A refusal because a call is already live carries that call's id, so the client can offer "Join". */
    start: async (req, res) => {
      try {
        const started = await service().start({
          channelId: req.params.id,
          user: req.user,
          socketId: req.body?.socketId,
        });
        res.status(201).json({ success: true, ...started });
      } catch (e) {
        if (e.code === 'call_in_progress')
          return res.status(409).json({ success: false, code: e.code, message: e.message, callId: e.callId ?? null });
        sendError(res, e);
      }
    },

    active: wrap(async (req, res) => {
      res.json({ success: true, ...(await service().activeCall({ channelId: req.params.id, userId: req.user.id })) });
    }),

    history: wrap(async (req, res) => {
      res.json({ success: true, calls: await service().listCalls({ channelId: req.params.id, userId: req.user.id }) });
    }),

    get: wrap(async (req, res) => {
      res.json({ success: true, ...(await service().get({ callId: req.params.id, userId: req.user.id })) });
    }),

    join: wrap(async (req, res) => {
      res.json({
        success: true,
        ...(await service().join({ callId: req.params.id, user: req.user, socketId: req.body?.socketId })),
      });
    }),

    leave: wrap(async (req, res) => {
      await service().leave({ callId: req.params.id, userId: req.user.id });
      res.json({ success: true });
    }),

    decline: wrap(async (req, res) => {
      await service().decline({ callId: req.params.id, user: req.user });
      res.json({ success: true });
    }),

    hostMute: wrap(async (req, res) => {
      await service().hostMute({ callId: req.params.id, user: req.user, targetUserId: req.params.userId });
      res.json({ success: true });
    }),

    hostRemove: wrap(async (req, res) => {
      await service().hostRemove({ callId: req.params.id, user: req.user, targetUserId: req.params.userId });
      res.json({ success: true });
    }),

    askToJoin: wrap(async (req, res) => {
      await service().askToJoin({ callId: req.params.id, user: req.user });
      res.json({ success: true });
    }),

    cancelAsk: wrap(async (req, res) => {
      await service().cancelAsk({ callId: req.params.id, userId: req.user.id });
      res.json({ success: true });
    }),

    answerJoinRequest: wrap(async (req, res) => {
      await service().answerJoinRequest({
        callId: req.params.id,
        user: req.user,
        targetUserId: req.params.userId,
        accept: req.body?.accept,
      });
      res.json({ success: true });
    }),

    screenShare: wrap(async (req, res) => {
      await service().screenShare({
        callId: req.params.id,
        userId: req.user.id,
        on: req.body?.on === true,
        socketId: req.body?.socketId,
      });
      res.json({ success: true });
    }),
  };
}
