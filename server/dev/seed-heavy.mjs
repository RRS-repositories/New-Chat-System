// Loads the local test chat with far more data than the office has, so slowness shows up on a
// developer PC before it shows up for staff. Used by local.mjs when SEED_HEAVY=1. Never run on a server.
//
//   SEED_HEAVY=1 node server/dev/local.mjs
//   SEED_HEAVY=1 SEED_MESSAGES=300000 SEED_CHANNELS=500 node server/dev/local.mjs

const int = (value, fallback) => (Number(value) > 0 ? Math.floor(Number(value)) : fallback);

/**
 * people: extra staff (the office has about 120).
 * messages: messages in #general, one second apart, newest last. Every 50th is a long one (about 4,000 characters).
 * channels: extra public channels everyone is in, each with a few unread messages.
 */
export async function seedHeavy(pg, env = process.env) {
  const people = int(env.SEED_PEOPLE, 120);
  const messages = int(env.SEED_MESSAGES, 100_000);
  const channels = int(env.SEED_CHANNELS, 300);
  const started = Date.now();

  await pg.exec(`
    INSERT INTO users (email, full_name, role)
      SELECT 'perf' || g || '@x', 'Person ' || lpad(g::text, 3, '0') || ' Example', 'Sales' FROM generate_series(1, ${people}) g;
    INSERT INTO chat.channel_members (channel_id, user_id)
      SELECT c.id, u.id FROM chat.channels c, users u WHERE c.name = 'general' AND u.is_active IS NOT FALSE
      ON CONFLICT DO NOTHING;

    -- A long busy channel. Senders rotate, so messages group the way real ones do.
    INSERT INTO chat.messages (channel_id, user_id, content, created_at)
      SELECT c.id,
             (SELECT id FROM users WHERE is_active IS NOT FALSE ORDER BY id OFFSET ((g / 3) % 20) LIMIT 1),
             CASE WHEN g % 50 = 0
                  THEN 'Long update ' || g || ': ' || repeat('The lender replied about the invoice and the client was told. ', 64)
                  ELSE 'Message ' || g || ' about invoice ' || (g % 977) || ' for the Vanquis claim' END,
             now() - ((${messages} - g) || ' seconds')::interval
        FROM chat.channels c, generate_series(1, ${messages}) g
       WHERE c.name = 'general';

    -- Many channels, each with unread messages for everyone but their author.
    INSERT INTO chat.channels (name, display_name, type, created_by)
      SELECT 'perf-' || lpad(g::text, 4, '0'), 'Team ' || lpad(g::text, 4, '0'), 'public', 1 FROM generate_series(1, ${channels}) g;
    INSERT INTO chat.channel_members (channel_id, user_id, last_read_at)
      SELECT c.id, u.id, now() - interval '30 days' FROM chat.channels c, users u
       WHERE c.name LIKE 'perf-%' AND u.is_active IS NOT FALSE
      ON CONFLICT DO NOTHING;
    INSERT INTO chat.messages (channel_id, user_id, content, created_at)
      SELECT c.id, 2, 'Update ' || g || ' in ' || c.display_name, now() - ((40 - g) || ' minutes')::interval
        FROM chat.channels c, generate_series(1, 20) g WHERE c.name LIKE 'perf-%';

    -- One channel nobody has read for a long time: the unread count must not make the channel list slow.
    UPDATE chat.channel_members m SET last_read_at = now() - interval '10 years'
      FROM chat.channels c WHERE c.id = m.channel_id AND c.name = 'general' AND m.user_id = 3;
    ANALYZE;
  `);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[local] heavy data loaded in ${secs}s: ${people} more people, ${messages} messages in #general, ${channels} more channels`,
  );
}
