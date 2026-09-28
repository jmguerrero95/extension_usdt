import type { FastifyInstance } from 'fastify';
import path from 'node:path';

import type { AdminPermission } from '../../shared/constants/admin-auth';
import { validateRequest } from '../../shared/validation/validate-request';
import {
  panelAddOrderNoteController,
  panelAuditLogsController,
  panelDashboardController,
  panelExportReportCsvController,
  panelExportReportPdfController,
  panelListOrdersController,
  panelListSettingsController,
  panelOrderActionController,
  panelOrderDetailController,
  panelProfileActivityController,
  panelProviderEventsController,
  panelReportController,
  panelTestSettingsConnectionController,
  panelUpdateSettingsController,
} from './panel.controller';
import { registerPanelAuthRoutes } from './panel-auth.routes';
import {
  addOrderNoteBodySchema,
  listAuditLogsQuerySchema,
  listOrdersQuerySchema,
  listProviderEventsQuerySchema,
  orderActionBodySchema,
  orderActionParamsSchema,
  orderParamsSchema,
  reportQuerySchema,
  testSettingsConnectionBodySchema,
  updateSettingsBodySchema,
} from './panel.schemas';
import { requirePanelCsrf, requirePanelPermission, requirePanelSession } from './panel-auth.guard';

const assertFreshStepUp = async (request: Parameters<typeof panelDashboardController>[0]) => {
  request.server.services.panelAuthService.assertStepUpFresh(
    request.adminSession as NonNullable<typeof request.adminSession>,
  );
};

export const registerPanelRoutes = async (app: FastifyInstance): Promise<void> => {
  await app.register(registerPanelAuthRoutes);

  app.get('/dashboard', {
    schema: {
      summary: 'Dashboard operativo del panel',
      description: 'Métricas resumidas, alertas y pendientes operativos.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('dashboard:view')],
    handler: panelDashboardController,
  });

  app.get('/orders', {
    schema: {
      summary: 'Buscar órdenes desde el panel',
      description: 'Listado con búsqueda operativa, filtros y paginación para BUY y SELL.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('orders:view')],
    preValidation: validateRequest({
      query: listOrdersQuerySchema,
    }),
    handler: panelListOrdersController,
  });

  app.get('/orders/:orderId', {
    schema: {
      summary: 'Detalle extendido de orden',
      description: 'Devuelve orden, timeline, notes, provider events y requests asociados.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('orders:view')],
    preValidation: validateRequest({
      params: orderParamsSchema,
    }),
    handler: panelOrderDetailController,
  });

  app.post('/orders/:orderId/notes', {
    schema: {
      summary: 'Agregar nota operativa',
      description: 'Registra una nota interna o escalación sobre una orden.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('orders:note'), requirePanelCsrf],
    preValidation: validateRequest({
      params: orderParamsSchema,
      body: addOrderNoteBodySchema,
    }),
    handler: panelAddOrderNoteController,
  });

  app.post('/orders/:orderId/actions/:action', {
    schema: {
      summary: 'Ejecutar acción manual sobre orden',
      description: 'Reconciliar, reintentar, cancelar, marcar manual review o cerrar manualmente según rol/estado.',
      tags: ['Panel'],
    },
    preHandler: [
      requirePanelSession(),
      requirePanelCsrf,
      async (request, reply) => {
        const { action } = request.params as { action: string };
        const permissionByAction: Record<string, AdminPermission> = {
          reconcile: 'orders:reconcile',
          'retry-energy': 'orders:retry-energy',
          'retry-buy-energy': 'orders:retry-energy',
          'retry-forward': 'orders:retry-forward',
          'retry-send': 'orders:retry-send',
          'mark-manual-review': 'orders:manual-review',
          'clear-manual-review': 'orders:clear-manual-review',
          cancel: 'orders:cancel',
          'complete-manually': 'orders:complete-manually',
          'resolve-outcome-unknown': 'orders:complete-manually',
        };
        const permission = permissionByAction[action];
        if (!permission) {
          return;
        }

        await requirePanelPermission(permission)(request, reply);
        await assertFreshStepUp(request);
      },
    ],
    preValidation: validateRequest({
      params: orderActionParamsSchema,
      body: orderActionBodySchema,
    }),
    handler: panelOrderActionController,
  });

  app.get('/audit/logs', {
    schema: {
      summary: 'Listar auditoría del panel',
      description: 'Eventos de acceso, seguridad, usuarios, settings y acciones operativas.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('audit:view')],
    preValidation: validateRequest({
      query: listAuditLogsQuerySchema,
    }),
    handler: panelAuditLogsController,
  });

  app.get('/provider-events', {
    schema: {
      summary: 'Listar eventos de proveedores',
      description: 'Consulta webhooks y callbacks recibidos por la aplicación.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('audit:view')],
    preValidation: validateRequest({
      query: listProviderEventsQuerySchema,
    }),
    handler: panelProviderEventsController,
  });

  app.get('/reports/orders', {
    schema: {
      summary: 'Reporte filtrado de órdenes',
      description: 'Genera un reporte resumido y detallado por rango, estado, terminal y tipo.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('reports:view')],
    preValidation: validateRequest({
      query: reportQuerySchema,
    }),
    handler: panelReportController,
  });

  app.get('/reports/orders/export.csv', {
    schema: {
      summary: 'Exportar reporte CSV',
      description: 'Exporta a CSV el resultado filtrado del reporte de órdenes.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('reports:view')],
    preValidation: validateRequest({
      query: reportQuerySchema,
    }),
    handler: panelExportReportCsvController,
  });

  app.get('/reports/orders/export.pdf', {
    schema: {
      summary: 'Exportar reporte PDF',
      description:
        'Exporta a PDF el resultado filtrado del reporte de ordenes con filtros y totales.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('reports:view')],
    preValidation: validateRequest({
      query: reportQuerySchema,
    }),
    handler: panelExportReportPdfController,
  });

  app.get('/settings', {
    schema: {
      summary: 'Listar configuración operativa del panel',
      description: 'Devuelve valores efectivos y overrides guardados para operación.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('settings:view')],
    handler: panelListSettingsController,
  });

  app.put('/settings', {
    schema: {
      summary: 'Guardar configuración operativa del panel',
      description: 'Guarda overrides seguros que se aplican en el siguiente reinicio.',
      tags: ['Panel'],
    },
    preHandler: [
      requirePanelPermission('settings:manage'),
      requirePanelCsrf,
      async (request) => {
        await assertFreshStepUp(request);
      },
    ],
    preValidation: validateRequest({
      body: updateSettingsBodySchema,
    }),
    handler: panelUpdateSettingsController,
  });

  app.post('/settings/test-connection', {
    schema: {
      summary: 'Probar conexion de proveedor',
      description:
        'Valida conectividad basica y credenciales operativas contra CryptoCurrencyAPI o iTRX.',
      tags: ['Panel'],
    },
    preHandler: [
      requirePanelPermission('settings:manage'),
      requirePanelCsrf,
      async (request) => {
        await assertFreshStepUp(request);
      },
    ],
    preValidation: validateRequest({
      body: testSettingsConnectionBodySchema,
    }),
    handler: panelTestSettingsConnectionController,
  });

  app.get('/profile/activity', {
    schema: {
      summary: 'Actividad de seguridad del usuario actual',
      description: 'Últimos eventos auth/security del usuario autenticado.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('profile:manage')],
    handler: panelProfileActivityController,
  });
};

export const registerPanelFrontendRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get('/panel', async (request, reply) => {
    return reply.sendFile('index.html', path.resolve(process.cwd(), 'panel'));
  });

  app.get('/panel/*', async (request, reply) => {
    const routePath = String((request.params as Record<string, string | undefined>)['*'] ?? '');
    if (routePath.startsWith('api/')) {
      return reply.callNotFound();
    }

    return reply.sendFile('index.html', path.resolve(process.cwd(), 'panel'));
  });
};
