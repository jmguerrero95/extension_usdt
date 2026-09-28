import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { buildSuccessResponse } from '../../shared/utils/api-response';
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

export const panelDashboardController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const dashboard = await request.server.services.panelConsoleService.getDashboard();
  reply.send(buildSuccessResponse(request.id, dashboard));
};

export const panelListOrdersController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as z.infer<typeof listOrdersQuerySchema>;
  const result = await request.server.services.panelConsoleService.searchOrders(query);
  reply.send(buildSuccessResponse(request.id, result));
};

export const panelOrderDetailController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { orderId } = request.params as z.infer<typeof orderParamsSchema>;
  const result = await request.server.services.panelConsoleService.getOrderDetail(orderId);
  reply.send(buildSuccessResponse(request.id, result));
};

export const panelAddOrderNoteController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { orderId } = request.params as z.infer<typeof orderParamsSchema>;
  const body = request.body as z.infer<typeof addOrderNoteBodySchema>;
  const note = await request.server.services.panelConsoleService.addOrderNote(
    orderId,
    request.adminUser as NonNullable<typeof request.adminUser>,
    body,
  );
  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'orders',
    action: 'order_note_added',
    actor: request.adminUser ?? null,
    targetType: 'order_note',
    targetId: note.id ?? null,
    orderId,
    metadata: {
      escalation: note.escalation,
    },
  });
  reply.status(201).send(buildSuccessResponse(request.id, note));
};

export const panelOrderActionController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { orderId, action } = request.params as z.infer<typeof orderActionParamsSchema>;
  const body = request.body as z.infer<typeof orderActionBodySchema>;
  const result = await request.server.services.panelConsoleService.runOrderAction(
    action,
    orderId,
    request.adminUser as NonNullable<typeof request.adminUser>,
    body,
  );
  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'orders',
    action: `order_action_${action}`,
    actor: request.adminUser ?? null,
    targetType: 'order',
    targetId: orderId,
    orderId,
    metadata: {
      reason: body.reason,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      stepUpVerified: Boolean(request.adminSession?.stepUpVerifiedAt),
    },
  });
  reply.send(buildSuccessResponse(request.id, result));
};

export const panelAuditLogsController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as z.infer<typeof listAuditLogsQuerySchema>;
  const logs = await request.server.services.panelConsoleService.getAuditLogs(query);
  reply.send(buildSuccessResponse(request.id, logs));
};

export const panelProviderEventsController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as z.infer<typeof listProviderEventsQuerySchema>;
  const events = await request.server.services.panelConsoleService.getProviderEvents(query);
  reply.send(buildSuccessResponse(request.id, events));
};

export const panelReportController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as z.infer<typeof reportQuerySchema>;
  const report = await request.server.services.panelConsoleService.buildReport(query);
  reply.send(buildSuccessResponse(request.id, report));
};

export const panelExportReportCsvController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as z.infer<typeof reportQuerySchema>;
  const csv = await request.server.services.panelConsoleService.exportReportCsv(query);
  reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', 'attachment; filename=\"operaciones.csv\"')
    .send(csv);
};

export const panelExportReportPdfController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as z.infer<typeof reportQuerySchema>;
  const pdf = await request.server.services.panelConsoleService.exportReportPdf(query);
  reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', 'attachment; filename=\"operaciones.pdf\"')
    .send(pdf);
};

export const panelListSettingsController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const settings = await request.server.services.panelSettingsService.listSettings();
  reply.send(buildSuccessResponse(request.id, settings));
};

export const panelUpdateSettingsController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const body = request.body as z.infer<typeof updateSettingsBodySchema>;
  const saved = await request.server.services.panelSettingsService.upsertSettings(body.items, {
    userId: request.adminUser?.id as string,
    email: request.adminUser?.email as string,
  });
  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'settings',
    action: 'settings_updated',
    actor: request.adminUser ?? null,
    targetType: 'system_settings',
    targetId: null,
    metadata: {
      keys: body.items.map((item) => item.key),
      stepUpVerified: Boolean(request.adminSession?.stepUpVerifiedAt),
    },
  });
  reply.send(
    buildSuccessResponse(request.id, {
      items: saved,
      appliesOnRestart: true,
    }),
  );
};

export const panelTestSettingsConnectionController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const body = request.body as z.infer<typeof testSettingsConnectionBodySchema>;
  const result = await request.server.services.panelSettingsService.testConnection(body);
  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'settings',
    action: 'settings_connection_tested',
    actor: request.adminUser ?? null,
    targetType: 'provider',
    targetId: body.provider,
    metadata: {
      ok: result.ok,
      reachable: result.reachable,
      authenticated: result.authenticated,
      providerStatus: 'providerStatus' in result ? result.providerStatus ?? null : null,
      stepUpVerified: Boolean(request.adminSession?.stepUpVerifiedAt),
    },
  });
  reply.send(buildSuccessResponse(request.id, result));
};

export const panelProfileActivityController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const activity = await request.server.services.panelConsoleService.getMySecurityActivity(
    request.adminUser?.id as string,
  );
  reply.send(buildSuccessResponse(request.id, activity));
};
