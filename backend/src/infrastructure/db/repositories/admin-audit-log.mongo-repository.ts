import type { AdminAuditLogRepository } from '../../../domain/repositories/admin-audit-log.repository';
import type { AdminAuditLog } from '../../../domain/entities/admin-audit-log.entity';
import { AdminAuditLogModel } from '../models/admin-audit-log.model';
import { toDomainEntity } from './mongo-mappers';

export class MongoAdminAuditLogRepository implements AdminAuditLogRepository {
  public async create(log: AdminAuditLog): Promise<AdminAuditLog> {
    const document = await AdminAuditLogModel.create(log);
    return toDomainEntity<AdminAuditLog>(document);
  }

  public async list(filters?: {
    category?: AdminAuditLog['category'];
    action?: string;
    actorUserId?: string;
    orderId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    skip?: number;
  }): Promise<AdminAuditLog[]> {
    const createdAt =
      filters?.dateFrom || filters?.dateTo
        ? {
            ...(filters.dateFrom ? { $gte: new Date(filters.dateFrom) } : {}),
            ...(filters.dateTo ? { $lte: new Date(filters.dateTo) } : {}),
          }
        : undefined;

    const documents = await AdminAuditLogModel.find({
      ...(filters?.category ? { category: filters.category } : {}),
      ...(filters?.action ? { action: filters.action } : {}),
      ...(filters?.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters?.orderId ? { orderId: filters.orderId } : {}),
      ...(createdAt ? { createdAt } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(filters?.limit ?? 100)
      .skip(filters?.skip ?? 0)
      .exec();

    return documents.map((document) => toDomainEntity<AdminAuditLog>(document));
  }
}
