export interface AdminSession {
  id?: string;
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
