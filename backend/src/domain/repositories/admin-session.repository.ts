import type { AdminSession } from '../entities/admin-session.entity';

export interface AdminSessionRepository {
  create(session: AdminSession): Promise<AdminSession>;
  findById(id: string): Promise<AdminSession | null>;
  findByTokenHash(sessionTokenHash: string): Promise<AdminSession | null>;
  listActiveByUserId(userId: string): Promise<AdminSession[]>;
  updateById(id: string, patch: Partial<AdminSession>): Promise<AdminSession | null>;
  revokeOtherSessions(userId: string, sessionId: string): Promise<void>;
  revokeAllByUserId(userId: string): Promise<void>;
}
