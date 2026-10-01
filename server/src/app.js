import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './auth.js';
import { perUserLimiter } from './rate-limit.js';
import { createChannelRoutes } from './routes/channels.js';
import { createMessageRoutes } from './routes/messages.js';
import { createBrowseRoutes } from './routes/browse.js';
import { createAdminRoutes } from './routes/admin.js';
import { createFileRoutes } from './routes/files.js';
import { createSearchRoutes } from './routes/search.js';
import { createUserRoutes } from './routes/users.js';
import { createAuthRoutes } from './routes/auth.js';
import { createPrefRoutes, createChannelPrefRoutes } from './routes/prefs.js';
import { createPushRoutes } from './routes/push.js';
import { createCallRoutes } from './routes/calls.js';
import { createPresence } from './presence/registry.js';
import { createNotifier } from './notify/index.js';

const DEFAULT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');

export function createApp({ config, db, emit, fetchImpl = fetch, presence = createPresence(), notifier = createNotifier(), calls = null }) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins, credentials: false }));
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'chat' }));

  const auth = requireAuth({ db, secret: config.sessionSecret, aud: config.sessionAud, requireBeta: config.requireBeta });
  app.use('/api/chat/auth', createAuthRoutes({ crmInternalUrl: config.crmInternalUrl, fetchImpl }));
  // Auth is scoped to the prefixes that exist, so an unknown /api/chat path
  // is a 404 rather than a 401 that hides whether the route exists.
  app.use(['/api/chat/channels', '/api/chat/users', '/api/chat/messages', '/api/chat/files', '/api/chat/search', '/api/chat/admin', '/api/chat/push', '/api/chat/calls'], auth);
  app.use('/api/chat/admin', createAdminRoutes({ db, presence }));
  app.use('/api/chat/search', createSearchRoutes({ db }));
  app.use('/api/chat/push', createPushRoutes({ db, config }));
  app.use('/api/chat/channels', createBrowseRoutes({ db, emit }));   // /browse and /:id/join — before the channels router so /browse is not read as an id
  app.use('/api/chat/channels', createChannelPrefRoutes({ db }));     // PATCH /:id/notify
  app.use('/api/chat', createCallRoutes({ db, calls, config }));      // /calls/... and /channels/:id/calls — before the channels router
  app.use('/api/chat/channels', createChannelRoutes({ db, emit }));
  app.use('/api/chat/users', createPrefRoutes({ db, presence, emit })); // /online, /me/preferences, /me/status — before the users router
  app.use('/api/chat/users', createUserRoutes({ db }));
  app.use('/api/chat', createFileRoutes({ db, emit, notifier, uploadsDir: config.uploadsDir, limiter: perUserLimiter({ windowMs: 60_000, max: 5 }) }));
  app.use('/api/chat', createMessageRoutes({ db, emit, notifier, limiter: perUserLimiter({ windowMs: 1000, max: 1 }) }));
  app.use('/api', (_req, res) => res.status(404).json({ success: false, code: 'not_found', message: 'No such route' }));

  const dist = config.uiDist || DEFAULT_DIST;
  // The service worker must never be served stale, or a fix to it would not reach browsers for an hour.
  app.get('/sw.js', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'sw.js'), (err) => { if (err) res.status(404).end(); }); });
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => {
    if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return res.status(404).end();
    res.sendFile(path.join(dist, 'index.html'), (err) => { if (err) res.status(503).send('Chat UI not built yet'); });
  });
  return app;
}
