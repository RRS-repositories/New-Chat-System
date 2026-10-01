-- CRM Chat: notifications, presence and calls (Plan: 2026-09-30-crm-chat-notifications-calls.md).
-- Idempotent. Apply after chat_001_schema.sql and chat_002_rich.sql.
ALTER TABLE chat.user_preferences ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE chat.user_preferences ADD COLUMN IF NOT EXISTS last_digest_at TIMESTAMPTZ;

-- When each person was last connected to chat (written when their last socket goes away).
CREATE TABLE IF NOT EXISTS chat.user_presence (
  user_id       INT PRIMARY KEY REFERENCES users(id),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_user ON chat.push_subscriptions(user_id);

-- One live (ringing or active) call per channel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_one_live ON chat.calls(channel_id) WHERE status IN ('ringing','active');
