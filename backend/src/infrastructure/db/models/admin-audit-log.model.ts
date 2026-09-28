import { Schema, model, models, type Model } from 'mongoose';

import { ADMIN_ROLES } from '../../../shared/constants/admin-auth';

export interface AdminAuditLogDocument {
  category: 'auth' | 'security' | 'orders' | 'settings' | 'users' | 'reports';
  action: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: (typeof ADMIN_ROLES)[number] | null;
  targetType: string | null;
  targetId: string | null;
  orderId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

const adminAuditLogSchema = new Schema<AdminAuditLogDocument>(
  {
    category: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    actorUserId: { type: String, default: null, index: true },
    actorEmail: { type: String, default: null },
    actorRole: { type: String, enum: ADMIN_ROLES, default: null },
    targetType: { type: String, default: null, index: true },
    targetId: { type: String, default: null, index: true },
    orderId: { type: String, default: null, index: true },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  {
    collection: 'admin_audit_logs',
    versionKey: false,
  },
);

adminAuditLogSchema.index({ category: 1, createdAt: -1 });
adminAuditLogSchema.index({ orderId: 1, createdAt: -1 });

export const AdminAuditLogModel: Model<AdminAuditLogDocument> =
  (models['AdminAuditLog'] as Model<AdminAuditLogDocument> | undefined) ??
  model<AdminAuditLogDocument>('AdminAuditLog', adminAuditLogSchema);
