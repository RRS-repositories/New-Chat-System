import crypto from 'node:crypto';

const hash = (s) => crypto.createHash('sha256').update(s).digest();

/**
 * The CRM's automatic messages arrive with a key, not a person's session: there is
 * no human behind them. Each bot has its own key setting (Sarah: CHAT_BOT_KEY, Eleanor:
 * CHAT_ELEANOR_KEY), so one can be changed without touching the other or anybody's
 * sign-in. The key decides which account posts. No key set at all = the route is closed.
 *
 * `bots`: [{ key, userId, actions }] — `actions` says whether that bot may put buttons
 * under its messages.
 */
export function requireBotKey({ bots }) {
  const known = bots.filter((b) => b.key).map((b) => ({ ...b, hash: hash(b.key) }));
  return (req, res, next) => {
    if (!known.length)
      return res
        .status(503)
        .json({ success: false, code: 'bot_not_configured', message: 'Bot posting is not switched on' });
    // Compare every time over the same length, and against every key, so a wrong key cannot be
    // found one character at a time from how long the answer takes.
    const given = hash(String(req.headers['x-chat-bot-key'] || ''));
    let bot = null;
    for (const b of known) if (crypto.timingSafeEqual(given, b.hash)) bot = b;
    if (!bot) return res.status(401).json({ success: false, code: 'bad_bot_key', message: 'Not a valid bot key' });
    req.bot = { userId: bot.userId, actions: !!bot.actions };
    next();
  };
}
