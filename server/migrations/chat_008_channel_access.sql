-- Per-channel access (12 Oct 2026): Management or IT may block a person from a channel. A blocked
-- person is removed from it at once and cannot join it or be added to it until allowed again.
-- General cannot be blocked. Safe to run again.
BEGIN;
CREATE TABLE IF NOT EXISTS chat.channel_blocks (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
  blocked_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_blocks_channel ON chat.channel_blocks(channel_id);
COMMIT;
