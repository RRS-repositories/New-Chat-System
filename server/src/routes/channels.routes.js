import { Router } from 'express';
import { createChannelController } from '../controllers/channels.controller.js';

/** Mounted at /api/chat/channels. */
export function createChannelRoutes(deps) {
  const channels = createChannelController(deps);
  const r = Router();
  r.get('/', channels.list);
  r.post('/dm', channels.openDm);
  r.post('/', channels.create);
  r.get('/:id', channels.get);
  r.patch('/:id', channels.update);
  r.post('/:id/archive', channels.archive);
  r.delete('/:id', channels.remove);
  r.post('/:id/members', channels.addMembers);
  r.delete('/:id/members/:userId', channels.removeMember);
  r.post('/:id/read', channels.markRead);
  r.post('/:id/unread', channels.markUnread);
  r.patch('/:id/favourite', channels.setFavourite);
  return r;
}
