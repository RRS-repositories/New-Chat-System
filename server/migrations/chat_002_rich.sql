-- CRM Chat Plan 2: indexes the rich-messaging queries need. All additive.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_mentions_message ON chat.mentions(message_id);
CREATE INDEX IF NOT EXISTS idx_mentions_user_channel_unread ON chat.mentions(user_id, channel_id) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_reactions_message ON chat.reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_files_message ON chat.files(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON chat.messages(thread_id, created_at ASC) WHERE thread_id IS NOT NULL;
COMMIT;
