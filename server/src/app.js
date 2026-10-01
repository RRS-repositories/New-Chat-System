import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './middleware/auth.js';
import { perUserLimiter } from './middleware/rate-limit.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { createChannelRoutes } from './routes/channels.routes.js';
import { createMessageRoutes } from './routes/messages.routes.js';
import { createBrowseRoutes } from './routes/browse.routes.js';
import { createAdminRoutes } from './routes/admin.routes.js';
import { createFileRoutes } from './routes/files.routes.js';
import { createSearchRoutes } from './routes/search.routes.js';
import { createUserRoutes } from './routes/users.routes.js';
import { createAuthRoutes } from './routes/auth.routes.js';
import { createPrefRoutes, createChannelPrefRoutes } from './routes/prefs.routes.js';
import { createPushRoutes } from './routes/push.routes.js';
import { createCallRoutes } from './routes/calls.routes.js';
import { createPresence } from './services/presence/registry.js';
import { createNotifier } from './services/notifications/notifier.js';

const GENERAL_REQUESTS_PER_MINUTE = 600;
const DEFAULT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');

export function createApp({
  config,
  db,
  emit,
  fetchImpl = fetch,
  presence = createPresence(),
  notifier = createNotifier(),
  calls = null,
}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins, credentials: false }));
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'chat' }));

  const auth = requireAuth({
    db,
    secret: config.sessionSecret,
    aud: config.sessionAud,
    requireBeta: config.requireBeta,
    enforceIp: config.enforceIpRestriction,
  });
  app.use('/api/chat/auth', createAuthRoutes({ crmInternalUrl: config.crmInternalUrl, fetchImpl }));
  // Auth is scoped to the prefixes that exist, so an unknown /api/chat path
  // is a 404 rather than a 401 that hides whether the route exists.
  app.use(
    [
      '/api/chat/channels',
      '/api/chat/users',
      '/api/chat/messages',
      '/api/chat/files',
      '/api/chat/search',
      '/api/chat/admin',
      '/api/chat/push',
      '/api/chat/calls',
    ],
    auth,
    // A ceiling on how fast one person can call the API at all. Normal use is far below it;
    // sending messages and uploading files have their own tighter limits further down.
    perUserLimiter({ windowMs: 60_000, max: GENERAL_REQUESTS_PER_MINUTE }),
  );
  app.use('/api/chat/admin', createAdminRoutes({ db, presence }));
  app.use('/api/chat/search', createSearchRoutes({ db }));
  app.use('/api/chat/push', createPushRoutes({ db, config }));
  app.use('/api/chat/channels', createBrowseRoutes({ db, emit })); // /browse and /:id/join — before the channels router so /browse is not read as an id
  app.use('/api/chat/channels', createChannelPrefRoutes({ db })); // PATCH /:id/notify
  app.use('/api/chat', createCallRoutes({ db, calls, config })); // /calls/... and /channels/:id/calls — before the channels router
  app.use('/api/chat/channels', createChannelRoutes({ db, emit }));
  app.use('/api/chat/users', createPrefRoutes({ db, presence, emit })); // /online, /me/preferences, /me/status — before the users router
  app.use('/api/chat/users', createUserRoutes({ db }));
  app.use(
    '/api/chat',
    createFileRoutes({
      db,
      emit,
      notifier,
      uploadsDir: config.uploadsDir,
      limiter: perUserLimiter({ windowMs: 60_000, max: 5 }),
    }),
  );
  app.use(
    '/api/chat',
    createMessageRoutes({ db, emit, notifier, limiter: perUserLimiter({ windowMs: 1000, max: 1 }) }),
  );
  app.use('/api', (_req, res) => res.status(404).json({ success: false, code: 'not_found', message: 'No such route' }));

  const dist = config.uiDist || DEFAULT_DIST;
  // The service worker must never be served stale, or a fix to it would not reach browsers for an hour.
  app.get('/sw.js', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'sw.js'), (err) => {
      if (err) res.status(404).end();
    });
  });
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => {
    if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return res.status(404).end();
    res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err) res.status(503).send('Chat UI not built yet');
    });
  });
  return app;
}
