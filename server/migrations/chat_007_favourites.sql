-- Favourite conversations (6 Oct 2026): a person's own star on a channel or direct message, shown
-- in a Favourites section at the top of their sidebar. Safe to run again.
BEGIN;
ALTER TABLE chat.channel_members ADD COLUMN IF NOT EXISTS favourite BOOLEAN NOT NULL DEFAULT false;
COMMIT;
