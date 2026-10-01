import { wrap } from '../middleware/errors.js';
import { listPublicChannels, joinPublicChannel } from '../models/browse.model.js';

export function createBrowseController({ db, emit }) {
  return {
    list: wrap(async (req, res) => {
      res.json({ success: true, channels: await listPublicChannels(db, { userId: req.user.id }) });
    }),

    join: wrap(async (req, res) => {
      const channelId = req.params.id;
      const { channel, joined } = await joinPublicChannel(db, { channelId, userId: req.user.id });
      // A retry that finds the person already a member must not re-join their connection to the
      // channel or announce them a second time. The answer is the same either way.
      if (joined) {
        emit.joinRoom(req.user.id, channelId);
        emit.toChannel(channelId, 'member_added', { channel_id: channelId, user_ids: [req.user.id] });
      }
      res.json({ success: true, channel });
    }),
  };
}
