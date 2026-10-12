import { ensureBotInChannel, renderCard, resolveChannelByName, resolveDmByEmail } from '../services/bot.service.js';
import { sendMessage } from '../services/messages.service.js';
import { cleanMessageContent } from '../utils/sanitize.js';
import { httpError, wrap } from '../middleware/errors.js';

/**
 * One way in for every automatic message the CRM sends (Phase 8). The CRM has about
 * 150 of them across 25 different pieces of sending code; they all end up here.
 */
export function createBotController({ db, emit, notifier = null, botUserId }) {
  return {
    post: wrap(async (req, res) => {
      if (!botUserId) throw httpError(503, 'bot_not_configured', 'No bot account is set for automatic messages');
      const {
        rows: [bot],
      } = await db.query(`SELECT id, full_name FROM users WHERE id = $1 AND COALESCE(is_active, true)`, [botUserId]);
      if (!bot) throw httpError(503, 'bot_account_missing', 'The bot account is missing or switched off');

      const { channel, email, text, card } = req.body || {};
      if (channel && email) throw httpError(400, 'two_targets', 'Give a channel or an email, not both');

      const content = cleanMessageContent(renderCard(card, text));
      if (!content) throw httpError(400, 'empty', 'An automatic message needs some text');

      const target = email
        ? await resolveDmByEmail(db, bot.id, email)
        : await resolveChannelByName(db, channel);

      // A direct message already has both people in it; a channel may not have the bot.
      if (!email) await ensureBotInChannel(db, target.id, bot.id);

      const message = await sendMessage(
        { db, emit, notifier },
        { channelId: target.id, sender: { id: bot.id, fullName: bot.full_name }, content },
      );
      res.json({ success: true, message_id: message.id, channel_id: target.id, delivered_to: target.display_name });
    }),

    /** So the CRM can check a channel name is real before it is wired to one. */
    target: wrap(async (req, res) => {
      const { channel, email } = req.query || {};
      const target = email ? await resolveDmByEmail(db, botUserId, email) : await resolveChannelByName(db, channel);
      res.json({ success: true, channel_id: target.id, delivered_to: target.display_name });
    }),
  };
}
