/** Browser storage keys. */
export const STORAGE_KEYS = {
  lastChannel: 'chat_last_channel',
  collapsedSections: 'chat.collapsed',
} as const;

/** Shown to someone who can sign in to the CRM but has not been switched on for chat. */
export const NOT_ENABLED_MESSAGE =
  'Team chat is not enabled for your account. Ask a manager to switch it on under Settings → Permissions.';

export const APP_TITLE = 'Chat';
