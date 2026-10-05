import { Router } from 'express';
import { createCallController } from '../controllers/calls.controller.js';

/** Mounted at /api/chat, before the channels router (so /channels/:id/calls is handled here). */
export function createCallRoutes(deps) {
  const calls = createCallController(deps);
  const r = Router();
  r.get('/calls/ice', calls.iceServers);
  r.post('/channels/:id/calls', calls.start);
  r.get('/channels/:id/calls/active', calls.active);
  r.get('/channels/:id/calls', calls.history);
  r.get('/calls/:id', calls.get);
  r.post('/calls/:id/join', calls.join);
  r.post('/calls/:id/leave', calls.leave);
  r.post('/calls/:id/decline', calls.decline);
  r.post('/calls/:id/screen-share', calls.screenShare);
  // Host controls (the person who started the call) and the removed person's request to come back.
  r.post('/calls/:id/participants/:userId/mute', calls.hostMute);
  r.post('/calls/:id/participants/:userId/remove', calls.hostRemove);
  r.post('/calls/:id/join-requests', calls.askToJoin);
  r.delete('/calls/:id/join-requests', calls.cancelAsk);
  r.post('/calls/:id/join-requests/:userId', calls.answerJoinRequest);
  // Ringing more people into a live call, and joining a ringing call to the call you are already in.
  r.post('/calls/:id/invite', calls.invite);
  r.delete('/calls/:id/invite/:userId', calls.cancelInvite);
  r.post('/calls/:id/merge', calls.merge);
  return r;
}
