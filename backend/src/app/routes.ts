import type { FastifyInstance } from 'fastify';

import { registerCasRoutes } from '../modules/cas/cas.routes';
import { registerHealthRoutes } from '../modules/health/health.routes';
import { registerAdminMaintenanceRoutes } from '../modules/admin/admin-maintenance.routes';
import { registerInternalOrderRoutes } from '../modules/orders/orders.routes';
import { registerPanelFrontendRoutes, registerPanelRoutes } from '../modules/panel/panel.routes';
import { registerInternalProviderEventRoutes } from '../modules/provider-events/provider-events.routes';
import { registerWebhookRoutes } from '../modules/webhooks/webhooks.routes';

export const registerRoutes = async (app: FastifyInstance): Promise<void> => {
  await registerHealthRoutes(app);
  await app.register(registerCasRoutes, { prefix: '/api/v1/cas' });
  await app.register(registerWebhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.register(registerInternalOrderRoutes, { prefix: '/api/v1/internal' });
  await app.register(registerInternalProviderEventRoutes, { prefix: '/api/v1/internal' });
  await app.register(registerAdminMaintenanceRoutes, { prefix: '/api/v1/admin' });
  await app.register(registerPanelRoutes, { prefix: '/panel/api' });
  await registerPanelFrontendRoutes(app);
};
