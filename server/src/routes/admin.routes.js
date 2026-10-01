import { Router } from 'express';
import { requireManagement } from '../middleware/auth.js';
import { createAdminController } from '../controllers/admin.controller.js';

/** Mounted at /api/chat/admin. Management only. */
export function createAdminRoutes(deps) {
  const admin = createAdminController(deps);
  const r = Router();
  r.use(requireManagement);
  r.get('/restrictions', admin.listRestrictions);
  r.get('/restrictions/user/:userId', admin.listRestrictionsForUser);
  r.post('/restrictions', admin.addRestriction);
  r.delete('/restrictions/:id', admin.removeRestriction);
  r.get('/users', admin.listUsers);
  r.put('/users/:userId/access', admin.setAccess);
  return r;
}
