-- CRM Chat: schema. Spec: Chat UI/CRM_Chat_Build_Spec (1).md §2.
-- User FKs are INT: public.users.id is integer. dm_key = 'dm:<lowId>:<highId>'
-- so two people opening a DM at the same moment can only ever create one.
BEGIN;
CREATE SCHEMA IF NOT EXISTS chat;

CREATE TABLE IF NOT EXISTS chat.channels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  name          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('public','private','dm','group_dm')),
  purpose       TEXT NOT NULL DEFAULT '',
  header        TEXT NOT NULL DEFAULT '',
  dm_key        TEXT,
  created_by    INT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ,
  UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS idx_channels_workspace ON chat.channels(workspace_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_dm_key ON chat.channels(dm_key) WHERE dm_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat.channel_members (
  channel_id    UUID NOT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES users(id),
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  muted         BOOLEAN NOT NULL DEFAULT false,
  notify_pref   TEXT NOT NULL DEFAULT 'default' CHECK (notify_pref IN ('all','mentions','nothing','default')),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_members_user ON chat.channel_members(user_id);

CREATE TABLE IF NOT EXISTS chat.messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id     UUID NOT NULL REFERENCES chat.channels(id),
  user_id        INT NOT NULL REFERENCES users(id),
  thread_id      UUID REFERENCES chat.messages(id),
  reply_to_id    UUID REFERENCES chat.messages(id),
  content        TEXT NOT NULL DEFAULT '',
  content_search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  type           TEXT NOT NULL DEFAULT 'message' CHECK (type IN ('message','system','join','leave','file','call')),
  pinned         BOOLEAN NOT NULL DEFAULT false,
  pinned_by      INT REFERENCES users(id),
  pinned_at      TIMESTAMPTZ,
  edited_at      TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata       JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON chat.messages(channel_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON chat.messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON chat.messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_search ON chat.messages USING GIN(content_search);
CREATE INDEX IF NOT EXISTS idx_messages_pinned ON chat.messages(channel_id) WHERE pinned = true;

CREATE TABLE IF NOT EXISTS chat.files (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
  channel_id     UUID NOT NULL REFERENCES chat.channels(id),
  user_id        INT NOT NULL REFERENCES users(id),
  filename       TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL,
  file_path      TEXT NOT NULL,
  thumbnail_path TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_files_channel ON chat.files(channel_id);

CREATE TABLE IF NOT EXISTS chat.mentions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
  channel_id    UUID NOT NULL REFERENCES chat.channels(id),
  user_id       INT NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL DEFAULT 'user' CHECK (type IN ('user','channel','all')),
  read          BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mentions_user_unread ON chat.mentions(user_id) WHERE read = false;

CREATE TABLE IF NOT EXISTS chat.reactions (
  message_id    UUID NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES users(id),
  emoji         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS chat.calls (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id     UUID NOT NULL REFERENCES chat.channels(id),
  initiated_by   INT NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL CHECK (type IN ('voice','video')),
  status         TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','active','ended','missed','declined')),
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  duration_secs  INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calls_channel ON chat.calls(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_active ON chat.calls(status) WHERE status IN ('ringing','active');

CREATE TABLE IF NOT EXISTS chat.call_participants (
  call_id        UUID NOT NULL REFERENCES chat.calls(id) ON DELETE CASCADE,
  user_id        INT NOT NULL REFERENCES users(id),
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at        TIMESTAMPTZ,
  is_sharing_screen BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (call_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat.communication_restrictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         INT NOT NULL REFERENCES users(id),
  target_user_id  INT NOT NULL REFERENCES users(id),
  restriction     TEXT NOT NULL DEFAULT 'all' CHECK (restriction IN ('all','dm','call','channel')),
  restricted_by   INT NOT NULL REFERENCES users(id),
  reason          TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_user_id, restriction)
);
CREATE INDEX IF NOT EXISTS idx_restrictions_user ON chat.communication_restrictions(user_id);
CREATE INDEX IF NOT EXISTS idx_restrictions_target ON chat.communication_restrictions(target_user_id);

CREATE TABLE IF NOT EXISTS chat.user_preferences (
  user_id             INT PRIMARY KEY REFERENCES users(id),
  desktop_notif       TEXT NOT NULL DEFAULT 'mentions' CHECK (desktop_notif IN ('all','mentions','nothing')),
  mobile_notif        TEXT NOT NULL DEFAULT 'mentions' CHECK (mobile_notif IN ('all','mentions','nothing')),
  theme               TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  message_display     TEXT NOT NULL DEFAULT 'standard' CHECK (message_display IN ('compact','standard')),
  send_on_enter       BOOLEAN NOT NULL DEFAULT true,
  status_text         TEXT NOT NULL DEFAULT '',
  status_emoji        TEXT NOT NULL DEFAULT '',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat.audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_id      INT NOT NULL REFERENCES users(id),
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON chat.audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS chat.push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       INT NOT NULL REFERENCES users(id),
  endpoint      TEXT NOT NULL UNIQUE,
  keys          JSONB NOT NULL,
  user_agent    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the one public channel everyone lands in. created_by = lowest active Management user.
INSERT INTO chat.channels (name, display_name, type, purpose, created_by)
SELECT 'general', 'General', 'public', 'Company-wide chat',
       (SELECT id FROM users WHERE role = 'Management' AND is_active IS NOT FALSE ORDER BY id LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM chat.channels WHERE name = 'general')
  AND EXISTS (SELECT 1 FROM users WHERE role = 'Management' AND is_active IS NOT FALSE);

-- Everyone approved and active starts in #general (new users are joined on
-- their first channel list by ensureDefaultMembership).
INSERT INTO chat.channel_members (channel_id, user_id, role)
SELECT c.id, u.id, 'member'
  FROM chat.channels c, users u
 WHERE c.name = 'general' AND u.is_approved = TRUE AND u.is_active IS NOT FALSE
ON CONFLICT DO NOTHING;
COMMIT;
