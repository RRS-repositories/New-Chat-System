import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller.js';

/** Mounted at /api/chat/auth. The only routes that do not need a session. */
export function createAuthRoutes(deps) {
  const auth = createAuthController(deps);
  const r = Router();
  r.post('/login', auth.login);
  return r;
}
