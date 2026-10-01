import { Router } from 'express';
import { createPushController } from '../controllers/push.controller.js';

/** Mounted at /api/chat/push. */
export function createPushRoutes(deps) {
  const push = createPushController(deps);
  const r = Router();
  r.get('/key', push.key);
  r.post('/subscribe', push.subscribe);
  r.post('/unsubscribe', push.unsubscribe);
  return r;
}
