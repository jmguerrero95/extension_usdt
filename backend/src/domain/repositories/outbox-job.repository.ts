import type { JobType } from '../../shared/constants/job-types';
import type { OutboxJob, OutboxJobStatus } from '../entities/outbox-job.entity';

export interface OutboxJobRepository {
  enqueue(job: OutboxJob): Promise<OutboxJob>;
  findDueJob(now: Date): Promise<OutboxJob | null>;
  claimJob(
    id: string,
    now: Date,
    workerId?: string,
    leader?: { ownerId: string; fencingToken: number },
    recoveryGeneration?: number | null,
  ): Promise<OutboxJob | null>;
  findById(id: string): Promise<OutboxJob | null>;
  recoverStaleRunningJobs(maxAgeMs: number): Promise<number>;
  interruptActiveJobsFromPreviousBoot(params: {
    bootId: string;
    interruptedAt: Date;
    reason: string;
  }): Promise<OutboxJob[]>;
  listInterruptedPendingQuarantine(): Promise<OutboxJob[]>;
  markQuarantineApplied(jobIds: string[], orderId: string | null, appliedAt: Date): Promise<void>;
  markQuarantineFailed(jobIds: string[], error: string): Promise<void>;
  cancelActiveJobsForOrder(orderId: string, reason: string, actorId: string): Promise<number>;
  interruptJob(id: string, bootId: string, reason: string): Promise<void>;
  completeJob(id: string, purgeAt?: Date | null): Promise<void>;
  rescheduleRunningReconcileJob(id: string, workerId: string, runAt: Date): Promise<boolean>;
  failJob(id: string, lastError: string, nextRunAt: Date | null): Promise<void>;
  findPendingByOrderAndType(orderId: string, jobType: JobType): Promise<OutboxJob | null>;
  findPendingByProviderEventAndType(providerEventId: string, jobType: JobType): Promise<OutboxJob | null>;
  reschedulePendingByOrderAndType(orderId: string, jobType: JobType, runAt: Date): Promise<OutboxJob | null>;
  listByStatus(status: OutboxJobStatus): Promise<OutboxJob[]>;
}
