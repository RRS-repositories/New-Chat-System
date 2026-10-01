import { wrap } from '../middleware/errors.js';
import { listActiveUsers } from '../models/users.model.js';
import { hiddenFromPicker } from '../models/restrictions.model.js';

export function createUserController({ db }) {
  return {
    me: (req, res) => res.json({ success: true, user: req.user }),

    /** The people the caller can pick from. People they are restricted from messaging are left out. */
    list: wrap(async (req, res) => {
      const users = await listActiveUsers(db, { exceptUserId: req.user.id });
      const hidden = new Set(await hiddenFromPicker(db, { forUserId: req.user.id }));
      res.json({ success: true, users: users.filter((u) => !hidden.has(u.id)) });
    }),
  };
}
