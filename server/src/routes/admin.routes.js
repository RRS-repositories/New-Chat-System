import { Router } from 'express';
import { requireManagement, requireManagementOrIT } from '../middleware/auth.js';
import { createAdminController } from '../controllers/admin.controller.js';

/** Mounted at /api/chat/admin. Management only, except the people list and setting a password, which IT may do too. */
export function createAdminRoutes(deps) {
  const admin = createAdminController(deps);
  const r = Router();
  r.get('/users', requireManagementOrIT, admin.listUsers);
  r.put('/users/:userId/password', requireManagementOrIT, admin.setPassword);
  r.use(requireManagement);
  r.get('/restrictions', admin.listRestrictions);
  r.get('/restrictions/user/:userId', admin.listRestrictionsForUser);
  r.post('/restrictions', admin.addRestriction);
  r.delete('/restrictions/:id', admin.removeRestriction);
  r.put('/users/:userId/access', admin.setAccess);
  return r;
}
