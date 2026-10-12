import { Router } from 'express';
import { requireManagementOrIT } from '../middleware/auth.js';
import { createAdminController } from '../controllers/admin.controller.js';

/** Mounted at /api/chat/admin. Management and IT (the owner, 12 Oct 2026: IT run the chat day to day). */
export function createAdminRoutes(deps) {
  const admin = createAdminController(deps);
  const r = Router();
  r.get('/users', requireManagementOrIT, admin.listUsers);
  r.put('/users/:userId/password', requireManagementOrIT, admin.setPassword);
  r.post('/users/:userId/deactivate', requireManagementOrIT, admin.deactivate);
  r.post('/users/:userId/reactivate', requireManagementOrIT, admin.reactivate);
  // Who may contact whom: Management and IT too, since 12 Oct 2026.
  r.use(requireManagementOrIT);
  r.get('/restrictions', admin.listRestrictions);
  r.get('/restrictions/user/:userId', admin.listRestrictionsForUser);
  r.post('/restrictions', admin.addRestriction);
  r.delete('/restrictions/:id', admin.removeRestriction);
  r.put('/users/:userId/access', admin.setAccess);
  return r;
}
