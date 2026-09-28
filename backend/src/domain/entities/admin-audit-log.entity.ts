import type { AdminRole } from '../../shared/constants/admin-auth';

export interface AdminAuditLog {
  id?: string;
  category: 'auth' | 'security' | 'orders' | 'settings' | 'users' | 'reports';
  action: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: AdminRole | null;
  targetType: string | null;
  targetId: string | null;
  orderId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
