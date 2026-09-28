import type { AdminAuditLog } from '../entities/admin-audit-log.entity';

export interface AdminAuditLogRepository {
  create(log: AdminAuditLog): Promise<AdminAuditLog>;
  list(filters?: {
    category?: AdminAuditLog['category'];
    action?: string;
    actorUserId?: string;
    orderId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    skip?: number;
  }): Promise<AdminAuditLog[]>;
}
