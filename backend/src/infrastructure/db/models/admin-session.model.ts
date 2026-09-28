import { Schema, model, models, type Model } from 'mongoose';

export interface AdminSessionDocument {
  sessionTokenHash: string;
  userId: string;
  csrfToken: string;
  requiresTwoFactorSetup: boolean;
  stepUpVerifiedAt: Date | null;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const adminSessionSchema = new Schema<AdminSessionDocument>(
  {
    sessionTokenHash: { type: String, required: true, unique: true, index: true, select: false },
    userId: { type: String, required: true, index: true },
    csrfToken: { type: String, required: true, select: false },
    requiresTwoFactorSetup: { type: Boolean, required: true, default: false },
    stepUpVerifiedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null, index: true },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  {
    collection: 'admin_sessions',
    timestamps: true,
    versionKey: false,
  },
);

adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AdminSessionModel: Model<AdminSessionDocument> =
  (models['AdminSession'] as Model<AdminSessionDocument> | undefined) ??
  model<AdminSessionDocument>('AdminSession', adminSessionSchema);
