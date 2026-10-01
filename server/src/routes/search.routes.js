import { Router } from 'express';
import { createSearchController } from '../controllers/search.controller.js';

/** Mounted at /api/chat/search. */
export function createSearchRoutes(deps) {
  const search = createSearchController(deps);
  const r = Router();
  r.get('/', search.search);
  return r;
}
