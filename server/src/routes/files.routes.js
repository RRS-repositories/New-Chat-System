import { Router } from 'express';
import { createFileController } from '../controllers/files.controller.js';

/** Mounted at /api/chat. `limiter` allows five uploads per minute per person. */
export function createFileRoutes({ limiter, ...deps }) {
  const files = createFileController(deps);
  const r = Router();
  r.post('/channels/:id/upload', limiter, files.receive, files.upload);
  r.get('/channels/:id/files', files.listForChannel);
  r.get('/files/:id/download', files.download);
  r.get('/files/:id/thumb', files.thumbnail);
  return r;
}
