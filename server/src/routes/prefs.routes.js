import { Router } from 'express';
import { createPrefController, createChannelPrefController } from '../controllers/prefs.controller.js';

/** Mounted at /api/chat/users BEFORE the users router. */
export function createPrefRoutes(deps) {
  const prefs = createPrefController(deps);
  const r = Router();
  r.get('/online', prefs.online);
  r.get('/me/preferences', prefs.getPreferences);
  r.patch('/me/preferences', prefs.updatePreferences);
  r.patch('/me/status', prefs.setStatus);
  return r;
}

/** Mounted at /api/chat/channels BEFORE the channels router. */
export function createChannelPrefRoutes(deps) {
  const prefs = createChannelPrefController(deps);
  const r = Router();
  r.patch('/:id/notify', prefs.setNotifyLevel);
  return r;
}
