import type { AdminRole } from '../../shared/constants/admin-auth';

export interface OrderNote {
  id?: string;
  orderId: string;
  authorUserId: string;
  authorDisplayName: string;
  authorRole: AdminRole;
  note: string;
  escalation: boolean;
  createdAt: Date;
  updatedAt: Date;
}
