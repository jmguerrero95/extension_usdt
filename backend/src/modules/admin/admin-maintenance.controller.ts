import type { FastifyReply, FastifyRequest } from 'fastify';

import type { StorageCleanupInput } from './storage-maintenance.service';
import { buildSuccessResponse } from '../../shared/utils/api-response';

export const adminStorageAnalyzeController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const result = await request.server.services.storageMaintenanceService.analyzeStorage();
  reply.send(buildSuccessResponse(request.id, result));
};

export const adminStorageCleanupController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const body = request.body as StorageCleanupInput;
  const metadata = {
    adminUserId: request.adminUser?.id ?? null,
    adminEmail: request.adminUser?.email ?? null,
    dryRun: body.dryRun,
    olderThanDays: body.olderThanDays,
    batchSize: body.batchSize,
    maxBatches: body.maxBatches,
    collections: body.collections,
  };

  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'settings',
    action: 'storage_cleanup_started',
    actor: request.adminUser ?? null,
    targetType: 'storage_cleanup',
    targetId: 'outbox_reconcile',
    metadata,
  });

  try {
    const result = await request.server.services.storageMaintenanceService.cleanupStorage(body);

    await request.server.services.adminAuditService.logRequest({
      request,
      category: 'settings',
      action: 'storage_cleanup_completed',
      actor: request.adminUser ?? null,
      targetType: 'storage_cleanup',
      targetId: 'outbox_reconcile',
      metadata: {
        ...metadata,
        cutoff: result.cutoff,
        eligibleBefore: result.eligibleBefore,
        deleted: result.deleted.outboxReconcile,
        remaining: result.remaining.outboxReconcile,
        hasMore: result.hasMore,
        batchesProcessed: result.batchesProcessed,
        durationMs: result.durationMs,
      },
    });

    reply.send(buildSuccessResponse(request.id, result));
  } catch (error) {
    await request.server.services.adminAuditService.logRequest({
      request,
      category: 'settings',
      action: 'storage_cleanup_failed',
      actor: request.adminUser ?? null,
      targetType: 'storage_cleanup',
      targetId: 'outbox_reconcile',
      metadata: {
        ...metadata,
        error: error instanceof Error ? error.message : 'unknown_error',
      },
    });
    throw error;
  }
};
