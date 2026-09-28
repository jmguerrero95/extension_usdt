import { Schema, model, models, type Model } from 'mongoose';

import { ADMIN_ROLES } from '../../../shared/constants/admin-auth';

export interface InternalUserDocument {
  email: string;
  displayName: string;
  role: (typeof ADMIN_ROLES)[number];
  passwordHash: string;
  active: boolean;
  twoFactorEnabled: boolean;
  twoFactorSecretEncrypted: string | null;
  pendingTwoFactorSecretEncrypted: string | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  mustRotatePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const internalUserSchema = new Schema<InternalUserDocument>(
  {
    email: { type: String, required: true, unique: true, index: true, lowercase: true },
    displayName: { type: String, required: true },
    role: { type: String, required: true, enum: ADMIN_ROLES },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, required: true, default: true, index: true },
    twoFactorEnabled: { type: Boolean, required: true, default: false },
    twoFactorSecretEncrypted: { type: String, default: null, select: false },
    pendingTwoFactorSecretEncrypted: { type: String, default: null, select: false },
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    mustRotatePassword: { type: Boolean, required: true, default: false },
  },
  {
    collection: 'internal_users',
    timestamps: true,
    versionKey: false,
  },
);

export const InternalUserModel: Model<InternalUserDocument> =
  (models['InternalUser'] as Model<InternalUserDocument> | undefined) ??
  model<InternalUserDocument>('InternalUser', internalUserSchema);
