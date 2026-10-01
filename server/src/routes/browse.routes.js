import { Router } from 'express';
import { createBrowseController } from '../controllers/browse.controller.js';

/**
 * Browse and join public channels. Mounted at /api/chat/channels BEFORE the channels router,
 * so `/browse` is handled here instead of being read as a channel id.
 */
export function createBrowseRoutes(deps) {
  const browse = createBrowseController(deps);
  const r = Router();
  r.get('/browse', browse.list);
  r.post('/:id/join', browse.join);
  return r;
}
