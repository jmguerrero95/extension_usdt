import type { FastifyInstance } from 'fastify';

import { validateRequest } from '../../shared/validation/validate-request';
import {
  requirePanelCsrf,
  requirePanelPermission,
} from '../panel/panel-auth.guard';
import {
  adminStorageAnalyzeController,
  adminStorageCleanupController,
} from './admin-maintenance.controller';
import { storageCleanupBodySchema } from './admin-maintenance.schemas';

const assertFreshStepUp = (
  request: Parameters<typeof adminStorageAnalyzeController>[0],
): void => {
  request.server.services.panelAuthService.assertStepUpFresh(
    request.adminSession as NonNullable<typeof request.adminSession>,
  );
};

const storageMaintenancePreHandlers = [
  requirePanelPermission('maintenance:storage'),
  requirePanelCsrf,
  assertFreshStepUp,
];

export const registerAdminMaintenanceRoutes = (app: FastifyInstance): void => {
  app.get('/maintenance/storage', {
    schema: {
      summary: 'Analizar almacenamiento historico',
      description: 'Resumen de volumen y candidatos elegibles para limpieza segura de reconciliacion.',
      tags: ['Admin Maintenance'],
    },
    preHandler: storageMaintenancePreHandlers,
    handler: adminStorageAnalyzeController,
  });

  app.post('/maintenance/storage/cleanup', {
    schema: {
      summary: 'Limpiar historico de reconciliacion',
      description: 'Elimina por lotes reconciliaciones completadas antiguas usando filtros estrictos.',
      tags: ['Admin Maintenance'],
    },
    preHandler: storageMaintenancePreHandlers,
    preValidation: validateRequest({
      body: storageCleanupBodySchema,
    }),
    handler: adminStorageCleanupController,
  });
};
