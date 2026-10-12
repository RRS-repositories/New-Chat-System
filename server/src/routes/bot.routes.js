import { Router } from 'express';
import { createBotController } from '../controllers/bot.controller.js';

/** Automatic messages from the CRM. Key in a header, no person's session. */
export function createBotRoutes({ db, emit, notifier, botUserId }) {
  const r = Router();
  const bot = createBotController({ db, emit, notifier, botUserId });
  r.post('/post', bot.post);
  r.get('/target', bot.target);
  return r;
}
