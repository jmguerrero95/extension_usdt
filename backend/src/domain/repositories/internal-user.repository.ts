import type { InternalUser } from '../entities/internal-user.entity';

export interface InternalUserRepository {
  count(): Promise<number>;
  create(user: InternalUser): Promise<InternalUser>;
  findById(id: string): Promise<InternalUser | null>;
  findByEmail(email: string): Promise<InternalUser | null>;
  list(): Promise<InternalUser[]>;
  updateById(id: string, patch: Partial<InternalUser>): Promise<InternalUser | null>;
}
