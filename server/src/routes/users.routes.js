import { Router } from 'express';
import { createAvatarController } from '../controllers/avatars.controller.js';
import { createUserController } from '../controllers/users.controller.js';

/** Mounted at /api/chat/users (after the preference routes). `avatarLimiter` allows a few photo uploads a minute per person. */
export function createUserRoutes({ avatarLimiter = (_req, _res, next) => next(), ...deps }) {
  const users = createUserController(deps);
  const avatars = createAvatarController(deps);
  const r = Router();
  r.get('/me', users.me);
  r.post('/me/avatar', avatarLimiter, avatars.receive, avatars.save);
  r.delete('/me/avatar', avatars.remove);
  r.get('/:id/avatar', avatars.show);
  r.get('/', users.list);
  return r;
}
