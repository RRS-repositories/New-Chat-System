-- Colour theme and profile photos.
--   * theme: the column existed but only allowed 'light', 'dark' or 'system'. It now holds the
--     person's choice as a small piece of JSON, {"mode":"dark","accent":"ocean"}, or '' for "not chosen".
--   * avatar_path / avatar_updated_at: the person's profile photo (a file under the uploads folder)
--     and when it last changed. Chat-only: the CRM's users table is not touched.
-- Safe to run again.
BEGIN;
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = 'chat' AND rel.relname = 'user_preferences' AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%theme%'
  LOOP
    EXECUTE format('ALTER TABLE chat.user_preferences DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE chat.user_preferences ALTER COLUMN theme SET DEFAULT '';
UPDATE chat.user_preferences SET theme = '' WHERE theme IN ('light', 'dark', 'system');
ALTER TABLE chat.user_preferences ADD COLUMN IF NOT EXISTS avatar_path TEXT;
ALTER TABLE chat.user_preferences ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;
COMMIT;
