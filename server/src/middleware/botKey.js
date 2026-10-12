import crypto from 'node:crypto';

/**
 * The CRM's automatic messages arrive with a key, not a person's session: there is
 * no human behind them. The key is its own setting (CHAT_BOT_KEY) rather than a
 * shared one, so it can be changed without touching anybody's sign-in, and an
 * unset key means the route is simply closed.
 */
export function requireBotKey({ key }) {
  return (req, res, next) => {
    if (!key)
      return res.status(503).json({ success: false, code: 'bot_not_configured', message: 'Bot posting is not switched on' });
    const given = String(req.headers['x-chat-bot-key'] || '');
    // Compare every time over the same length, so a wrong key cannot be found
    // one character at a time from how long the answer takes.
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(key).digest();
    if (!crypto.timingSafeEqual(a, b))
      return res.status(401).json({ success: false, code: 'bad_bot_key', message: 'Not a valid bot key' });
    next();
  };
}
