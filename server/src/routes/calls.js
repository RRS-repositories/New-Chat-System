import { Router } from 'express';
import { httpError, sendError, wrap } from '../http-errors.js';
import { buildIceServers } from '../calls/ice.js';

/**
 * /calls/ice, /calls/:id, /calls/:id/(join|leave|decline|screen-share), /channels/:id/calls,
 * /channels/:id/calls/active — mounted at /api/chat (before the channels router), behind auth.
 * The call service does the checks; these handlers only shape the HTTP answer.
 */
export function createCallRoutes({ db, calls, config = {} }) {
  void db;
  const r = Router();
  const svc = () => { if (!calls) throw httpError(503, 'unavailable', 'Calls are not available'); return calls; };

  r.get('/calls/ice', wrap(async (req, res) => {
    const iceServers = calls?.iceServersFor ? calls.iceServersFor(req.user.id) : buildIceServers({ config, userId: req.user.id });
    res.json({ success: true, iceServers });
  }));

  // 409 call_in_progress carries the live call's id so the client can offer "Join" instead.
  r.post('/channels/:id/calls', async (req, res) => {
    try {
      const out = await svc().start({ channelId: req.params.id, user: req.user, socketId: req.body?.socketId });
      res.status(201).json({ success: true, ...out });
    } catch (e) {
      if (e.code === 'call_in_progress') return res.status(409).json({ success: false, code: e.code, message: e.message, callId: e.callId ?? null });
      sendError(res, e);
    }
  });

  r.get('/channels/:id/calls/active', wrap(async (req, res) => {
    const out = await svc().activeCall({ channelId: req.params.id, userId: req.user.id });
    res.json({ success: true, ...out });
  }));

  r.get('/channels/:id/calls', wrap(async (req, res) => {
    res.json({ success: true, calls: await svc().listCalls({ channelId: req.params.id, userId: req.user.id }) });
  }));

  r.get('/calls/:id', wrap(async (req, res) => {
    res.json({ success: true, ...(await svc().get({ callId: req.params.id, userId: req.user.id })) });
  }));

  r.post('/calls/:id/join', wrap(async (req, res) => {
    res.json({ success: true, ...(await svc().join({ callId: req.params.id, user: req.user, socketId: req.body?.socketId })) });
  }));

  r.post('/calls/:id/leave', wrap(async (req, res) => {
    await svc().leave({ callId: req.params.id, userId: req.user.id });
    res.json({ success: true });
  }));

  r.post('/calls/:id/decline', wrap(async (req, res) => {
    await svc().decline({ callId: req.params.id, user: req.user });
    res.json({ success: true });
  }));

  r.post('/calls/:id/screen-share', wrap(async (req, res) => {
    await svc().screenShare({ callId: req.params.id, userId: req.user.id, on: req.body?.on === true, socketId: req.body?.socketId });
    res.json({ success: true });
  }));

  return r;
}
