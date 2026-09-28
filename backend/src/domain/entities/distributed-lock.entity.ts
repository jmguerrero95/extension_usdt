export interface DistributedLock {
  id?: string;
  lockKey: string;
  leaseId?: string | null;
  ownerId: string | null;
  bootId?: string | null;
  acquiredAt?: Date | null;
  heartbeatAt?: Date | null;
  releasedAt?: Date | null;
  expiresAt: Date;
  fencingToken?: number;
  createdAt: Date;
}
