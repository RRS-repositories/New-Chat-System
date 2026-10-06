-- Copying Mattermost into the chat (6 Oct 2026): remembers which Mattermost row became which chat row,
-- so the copy can be run again and skips what is already here. Nothing else reads this table.
-- Safe to run again.
BEGIN;
CREATE TABLE IF NOT EXISTS chat.import_map (
  kind       TEXT NOT NULL,          -- 'channel', 'message', 'file'
  source_id  TEXT NOT NULL,          -- the Mattermost id
  target_id  TEXT NOT NULL,          -- the chat id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, source_id)
);
COMMIT;
