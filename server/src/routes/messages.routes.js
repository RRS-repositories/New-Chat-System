import { Router } from 'express';
import { createMessageController } from '../controllers/messages.controller.js';

/** Mounted at /api/chat. `limiter` allows one message per second per person. */
export function createMessageRoutes({ limiter, ...deps }) {
  const messages = createMessageController(deps);
  const r = Router();
  r.get('/channels/:id/messages', messages.list);
  r.post('/channels/:id/messages', messages.validateSend, limiter, messages.send);
  r.get('/channels/:id/pins', messages.listPins);
  r.get('/messages/:id/thread', messages.thread);
  r.patch('/messages/:id', messages.edit);
  r.delete('/messages/:id', messages.remove);
  r.post('/messages/:id/pin', messages.pin);
  r.delete('/messages/:id/pin', messages.unpin);
  r.post('/messages/:id/reactions', messages.addReaction);
  r.delete('/messages/:id/reactions/:emoji', messages.removeReaction);
  return r;
}
