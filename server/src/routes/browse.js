import { Router } from 'express';
import { wrap } from '../http-errors.js';
import { listPublicChannels, joinPublicChannel } from '../repo/browse.js';

/** Browse & join public channels. Mounted at /api/chat/channels BEFORE the channels router,
 * so /browse is handled here instead of being read as a channel id by GET /:id. */
export function createBrowseRoutes({ db, emit }) {
  const r = Router();

  r.get('/browse', wrap(async (req, res) => {
    res.json({ success: true, channels: await listPublicChannels(db, { userId: req.user.id }) });
  }));

  r.post('/:id/join', wrap(async (req, res) => {
    const channelId = req.params.id;
    const { channel, joined } = await joinPublicChannel(db, { channelId, userId: req.user.id });
    // Idempotent from the client's view either way — but a retry that finds the caller already
    // a member must not re-join their socket room or re-broadcast member_added to the channel.
    if (joined) {
      emit.joinRoom(req.user.id, channelId);
      emit.toChannel(channelId, 'member_added', { channel_id: channelId, user_ids: [req.user.id] });
    }
    res.json({ success: true, channel });
  }));

  return r;
}
