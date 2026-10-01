-- Search stays fast as the message table grows.
--   * part-of-a-word matching (ILIKE '%text%') needs a trigram index, or every search reads every message;
--   * "what this person wrote" needs an index by sender;
--   * "newest first" across all of a person's channels needs an index by time.
-- Safe to run again. On the live database pg_trgm is already installed (the CRM uses it).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm ON chat.messages USING GIN (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON chat.messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_created ON chat.messages (created_at DESC, id DESC);
COMMIT;
