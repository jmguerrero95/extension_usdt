import type { AdminRole } from '../../shared/constants/admin-auth';

export interface InternalUser {
  id?: string;
  email: string;
  displayName: string;
  role: AdminRole;
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
