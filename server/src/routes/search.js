import { Router } from 'express';
import { httpError, wrap } from '../http-errors.js';
import { searchMessages } from '../repo/search.js';

export function createSearchRoutes({ db }) {
  const r = Router();
  r.get('/', wrap(async (req, res) => {
    if (typeof req.query.q !== 'string') throw httpError(400, 'bad_query', 'q is required');
    const out = await searchMessages(db, { userId: req.user.id, q: req.query.q, channelId: req.query.channelId ? String(req.query.channelId) : null, page: req.query.page });
    res.json({ success: true, ...out });
  }));
  return r;
}
