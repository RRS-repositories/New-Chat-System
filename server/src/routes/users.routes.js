import { Router } from 'express';
import { createUserController } from '../controllers/users.controller.js';

/** Mounted at /api/chat/users (after the preference routes). */
export function createUserRoutes(deps) {
  const users = createUserController(deps);
  const r = Router();
  r.get('/me', users.me);
  r.get('/', users.list);
  return r;
}
