import type { FastifyRequest } from 'fastify';

import type { AdminAuditLog } from '../../domain/entities/admin-audit-log.entity';
import type { AdminAuditLogRepository } from '../../domain/repositories/admin-audit-log.repository';
import type { InternalUser } from '../../domain/entities/internal-user.entity';

export class AdminAuditService {
  public constructor(private readonly repository: AdminAuditLogRepository) {}

  public async log(
    entry: Omit<AdminAuditLog, 'createdAt'>,
  ): Promise<AdminAuditLog> {
    return this.repository.create({
      ...entry,
      createdAt: new Date(),
    });
  }

  public async logRequest(params: {
    request: FastifyRequest;
    category: AdminAuditLog['category'];
    action: string;
    actor: InternalUser | null;
    targetType?: string | null;
    targetId?: string | null;
    orderId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<AdminAuditLog> {
    return this.log({
      category: params.category,
      action: params.action,
      actorUserId: params.actor?.id ?? null,
      actorEmail: params.actor?.email ?? null,
      actorRole: params.actor?.role ?? null,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      orderId: params.orderId ?? null,
      ipAddress: params.request.ip ?? null,
      userAgent: params.request.headers['user-agent'] ?? null,
      metadata: params.metadata ?? null,
    });
  }

  public async list(filters?: Parameters<AdminAuditLogRepository['list']>[0]) {
    return this.repository.list(filters);
  }
}
