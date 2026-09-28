import type { JobType } from '../../shared/constants/job-types';

export type OutboxJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'INTERRUPTED'
  | 'CANCELED';

export interface OutboxJob {
  id?: string;
  jobType: JobType;
  orderId: string | null;
  providerEventId?: string | null;
  payload: Record<string, unknown>;
  status: OutboxJobStatus;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy?: string | null;
  leaderOwnerId?: string | null;
  leaderFencingToken?: number | null;
  recoveryGeneration?: number | null;
  createdBootId?: string | null;
  claimedBootId?: string | null;
  lastBootId?: string | null;
  interruptedAt?: Date | null;
  interruptedByBootId?: string | null;
  interruptionReason?: string | null;
  purgeAt?: Date | null;
  executionCount?: number;
  consecutiveFailureCount?: number;
  lastRunAt?: Date | null;
  lastSuccessAt?: Date | null;
  manualReviewAppliedAt?: Date | null;
  manualReviewOrderId?: string | null;
  quarantineStatus?: 'PENDING' | 'APPLIED' | 'FAILED' | null;
  quarantineLastError?: string | null;
  cancelRequestedAt?: Date | null;
  cancelReason?: string | null;
  cancelRequestedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
