// One place that wires http + Express + Socket.IO, used by main.js and tests.
// Express is the http server's request handler and Socket.IO wraps it, so a
// /socket.io request is answered by engine.io alone. (Adding Express as a
// second 'request' listener made both answer and crashed the process on
// ERR_HTTP_HEADERS_SENT.)
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { attachSocket } from './sockets/index.js';
import { createPresence } from './services/presence/registry.js';
import { createNotifier } from './services/notifications/notifier.js';
import { createCallService } from './services/calls/call.service.js';

export function createHttpStack({ config, db, fetchImpl, sessionRecheckMs, webpush = null }) {
  const io = new Server({ cors: config.corsOrigins.length ? { origin: config.corsOrigins } : undefined, path: '/socket.io' });
  const presence = createPresence({ graceMs: config.presenceOfflineGraceMs });
  const notifier = createNotifier({ db, presence, config, webpush });
  // The call service needs `emit`, which only exists once the sockets are attached;
  // connections arrive later still, so the getter always sees the real service.
  let calls = null;
  const sockets = attachSocket(io, { db, secret: config.sessionSecret, aud: config.sessionAud, redisUrl: config.redisUrl, sessionRecheckMs, requireBeta: config.requireBeta, presence, getCalls: () => calls });
  calls = createCallService({ db, emit: sockets.emit, notifier, config, socketsOfUser: (userId) => presence.socketsOf(userId) });
  const app = createApp({ config, db, emit: sockets.emit, fetchImpl, presence, notifier, calls });
  const httpServer = createServer(app);
  io.attach(httpServer);
  return {
    httpServer, io, app, sockets, presence, notifier, calls,
    async close() {
      calls.close?.();
      presence.close?.();   // no offline callbacks after the pool is gone
      await new Promise((r) => io.close(() => r()));
      await new Promise((r) => httpServer.close(() => r()));
      await sockets.close().catch(() => {});
    },
  };
}
