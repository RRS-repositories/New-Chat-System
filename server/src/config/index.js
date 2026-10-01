// All process.env reads live here. Everything else receives a config object.
const list = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
export function loadConfig(env = process.env) {
  const secret = env.SESSION_JWT_SECRET || '';
  if (secret.length < 32)
    throw new Error('SESSION_JWT_SECRET missing or weak (need >= 32 chars; same value as the CRM)');
  return {
    port: parseInt(env.CHAT_PORT || '5020', 10),
    dbHost: env.DB_HOST,
    dbPort: parseInt(env.DB_PORT || '5432', 10),
    dbName: env.DB_NAME,
    dbUser: env.DB_USER,
    dbPassword: String(env.DB_PASSWORD || ''),
    dbSsl: env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    redisUrl: env.REDIS_URL || '',
    sessionSecret: secret,
    sessionAud: 'rrs-crm-session',
    corsOrigins: String(env.CHAT_CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    crmInternalUrl: (env.CRM_INTERNAL_URL || 'http://127.0.0.1:5000').replace(/\/$/, ''),
    uploadsDir: env.CHAT_UPLOADS_DIR || '/data/chat-uploads',
    // The chat.beta gate defaults ON: unset or 'true' -> true, only 'false' turns it off.
    requireBeta: env.CHAT_REQUIRE_BETA !== 'false',
    // Web Push (VAPID). Push is simply off when the keys are missing.
    vapidPublic: env.CHAT_VAPID_PUBLIC || '',
    vapidPrivate: env.CHAT_VAPID_PRIVATE || '',
    vapidSubject: env.CHAT_VAPID_SUBJECT || 'mailto:it@rowanrose.co.uk',
    // Calls: free public STUN + our own coturn (use-auth-secret). No paid relay.
    stunUrls: list(env.CHAT_STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478'),
    turnUrls: list(env.CHAT_TURN_URLS || ''),
    turnSecret: env.CHAT_TURN_SECRET || '',
    turnTtlSecs: 43200,
    callRingMs: 30_000,
    callMaxParticipants: 8,
    callDisconnectGraceMs: 10_000,
    presenceOfflineGraceMs: 5000,
    // Daily digest of unread mentions — off unless explicitly enabled.
    digestEnabled: env.CHAT_DIGEST_ENABLED === 'true',
    digestHourUtc: 8,
    smtp: {
      host: env.SMTP_HOST || '',
      port: parseInt(env.SMTP_PORT || '587', 10),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || '',
      password: env.SMTP_PASSWORD || '',
    },
    mailFrom: env.MAIL_FROM || '',
    mailFromName: env.MAIL_FROM_NAME || '',
    publicUrl: (env.CHAT_PUBLIC_URL || 'https://crm.rowanroseclaims.co.uk/chat').replace(/\/$/, ''),
  };
}
