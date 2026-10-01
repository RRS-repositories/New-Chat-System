import { httpError, wrap } from '../middleware/errors.js';
import { searchMessages } from '../models/search.model.js';

export function createSearchController({ db }) {
  return {
    search: wrap(async (req, res) => {
      if (typeof req.query.q !== 'string') throw httpError(400, 'bad_query', 'q is required');
      const channelId = req.query.channelId ? String(req.query.channelId) : null;
      const results = await searchMessages(db, {
        userId: req.user.id,
        q: req.query.q,
        channelId,
        page: req.query.page,
      });
      res.json({ success: true, ...results });
    }),
  };
}
