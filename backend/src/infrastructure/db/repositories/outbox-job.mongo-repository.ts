import type { OutboxJobRepository } from '../../../domain/repositories/outbox-job.repository';
import type { JobType } from '../../../shared/constants/job-types';
import type { OutboxJob, OutboxJobStatus } from '../../../domain/entities/outbox-job.entity';
import { OutboxJobModel } from '../models/outbox-job.model';
import { DistributedLockModel } from '../models/distributed-lock.model';
import { toDomainEntity } from './mongo-mappers';

export class MongoOutboxJobRepository implements OutboxJobRepository {
  public async enqueue(job: OutboxJob): Promise<OutboxJob> {
    const document = await OutboxJobModel.create(job);
    return toDomainEntity<OutboxJob>(document);
  }

  public async findDueJob(now: Date): Promise<OutboxJob | null> {
    const document = await OutboxJobModel.findOne({
      status: 'PENDING',
      runAt: { $lte: now },
    })
      .sort({ runAt: 1, createdAt: 1 })
      .exec();

    return document ? toDomainEntity<OutboxJob>(document) : null;
  }

  public async claimJob(
    id: string,
    now: Date,
    workerId?: string,
    leader?: { ownerId: string; fencingToken: number },
    recoveryGeneration?: number | null,
  ): Promise<OutboxJob | null> {
    const document = await OutboxJobModel.findOneAndUpdate(
      {
        _id: id,
        status: 'PENDING',
        runAt: { $lte: now },
      },
      {
        $set: {
          status: 'RUNNING',
          lockedAt: now,
          lockedBy: workerId ?? null,
          leaderOwnerId: leader?.ownerId ?? null,
          leaderFencingToken: leader?.fencingToken ?? null,
          recoveryGeneration: recoveryGeneration ?? null,
          claimedBootId: workerId ?? null,
          lastBootId: workerId ?? null,
        },
      },
      {
        returnDocument: 'after',
      },
    ).exec();

    return document ? toDomainEntity<OutboxJob>(document) : null;
  }

  public async findById(id: string): Promise<OutboxJob | null> {
    const document = await OutboxJobModel.findById(id).exec();
    return document ? toDomainEntity<OutboxJob>(document) : null;
  }

  public async recoverStaleRunningJobs(maxAgeMs: number): Promise<number> {
    const staleBefore = new Date(Date.now() - maxAgeMs);
    const now = new Date();

    const result = await OutboxJobModel.updateMany(
      {
        status: 'RUNNING',
        lockedAt: { $ne: null, $lt: staleBefore },
      },
      {
        $set: {
          status: 'PENDING',
          lockedAt: null,
          runAt: now,
          updatedAt: now,
        },
      },
    ).exec();

    return result.modifiedCount;
  }

  public async interruptActiveJobsFromPreviousBoot(params: {
    bootId: string;
    interruptedAt: Date;
    reason: string;
  }): Promise<OutboxJob[]> {
    const pendingDocuments = await OutboxJobModel.find({
      status: 'PENDING',
      $or: [{ createdBootId: { $exists: false } }, { createdBootId: null }, { createdBootId: { $ne: params.bootId } }],
    }).exec();

    const runningCandidates = await OutboxJobModel.find({
      status: 'RUNNING',
    }).exec();

    const runningDocuments = [];
    for (const document of runningCandidates) {
      if (!document.leaderOwnerId || document.leaderFencingToken === null || document.leaderFencingToken === undefined) {
        runningDocuments.push(document);
        continue;
      }

      const liveLeader = await DistributedLockModel.exists({
        ownerId: document.leaderOwnerId,
        bootId: document.claimedBootId,
        fencingToken: document.leaderFencingToken,
        expiresAt: { $gt: params.interruptedAt },
      }).exec();

      if (!liveLeader) {
        runningDocuments.push(document);
      }
    }

    const documents = [...pendingDocuments, ...runningDocuments];

    if (documents.length === 0) {
      return [];
    }

    const ids = documents.map((document) => document._id);
    await OutboxJobModel.updateMany(
      {
        _id: { $in: ids },
        status: { $in: ['PENDING', 'RUNNING'] },
      },
      {
        $set: {
          status: 'INTERRUPTED',
          lockedAt: null,
          lockedBy: null,
          interruptedAt: params.interruptedAt,
          interruptedByBootId: params.bootId,
          interruptionReason: params.reason,
          quarantineStatus: 'PENDING',
          lastBootId: params.bootId,
          updatedAt: params.interruptedAt,
        },
      },
    ).exec();

    return documents.map((document) => toDomainEntity<OutboxJob>(document));
  }

  public async listInterruptedPendingQuarantine(): Promise<OutboxJob[]> {
    const documents = await OutboxJobModel.find({
      status: 'INTERRUPTED',
      quarantineStatus: { $ne: 'APPLIED' },
    }).exec();

    return documents.map((document) => toDomainEntity<OutboxJob>(document));
  }

  public async markQuarantineApplied(
    jobIds: string[],
    orderId: string | null,
    appliedAt: Date,
  ): Promise<void> {
    await OutboxJobModel.updateMany(
      { _id: { $in: jobIds } },
      {
        $set: {
          quarantineStatus: 'APPLIED',
          manualReviewAppliedAt: appliedAt,
          manualReviewOrderId: orderId,
          quarantineLastError: null,
          updatedAt: appliedAt,
        },
      },
    ).exec();
  }

  public async markQuarantineFailed(jobIds: string[], error: string): Promise<void> {
    await OutboxJobModel.updateMany(
      { _id: { $in: jobIds } },
      {
        $set: {
          quarantineStatus: 'FAILED',
          quarantineLastError: error,
          updatedAt: new Date(),
        },
      },
    ).exec();
  }

  public async cancelActiveJobsForOrder(
    orderId: string,
    reason: string,
    actorId: string,
  ): Promise<number> {
    const now = new Date();
    const result = await OutboxJobModel.updateMany(
      {
        orderId,
        status: { $in: ['PENDING', 'RUNNING'] },
      },
      {
        $set: {
          status: 'CANCELED',
          lockedAt: null,
          lockedBy: null,
          cancelRequestedAt: now,
          cancelReason: reason,
          cancelRequestedBy: actorId,
          interruptedAt: now,
          interruptedByBootId: actorId,
          interruptionReason: reason,
          updatedAt: now,
        },
      },
    ).exec();

    return result.modifiedCount;
  }

  public async interruptJob(id: string, bootId: string, reason: string): Promise<void> {
    const now = new Date();
    await OutboxJobModel.findOneAndUpdate(
      { _id: id, status: 'RUNNING' },
      {
        $set: {
          status: 'INTERRUPTED',
          lockedAt: null,
          lockedBy: null,
          interruptedAt: now,
          interruptedByBootId: bootId,
          interruptionReason: reason,
          quarantineStatus: 'PENDING',
          updatedAt: now,
        },
      },
    ).exec();
  }

  public async completeJob(id: string, purgeAt?: Date | null): Promise<void> {
    const now = new Date();
    await OutboxJobModel.findOneAndUpdate(
      { _id: id, status: 'RUNNING' },
      {
        $set: {
          status: 'COMPLETED',
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          lastSuccessAt: now,
          purgeAt: purgeAt ?? null,
          updatedAt: now,
        },
      },
    ).exec();
  }

  public async rescheduleRunningReconcileJob(
    id: string,
    workerId: string,
    runAt: Date,
  ): Promise<boolean> {
    const now = new Date();
    const result = await OutboxJobModel.updateOne(
      {
        _id: id,
        status: 'RUNNING',
        lockedBy: workerId,
      },
      {
        $set: {
          status: 'PENDING',
          runAt,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          lastRunAt: now,
          lastSuccessAt: now,
          attempts: 0,
          consecutiveFailureCount: 0,
          updatedAt: now,
        },
        $unset: {
          purgeAt: 1,
        },
        $inc: {
          executionCount: 1,
        },
      },
    ).exec();

    return result.modifiedCount === 1;
  }

  public async failJob(id: string, lastError: string, nextRunAt: Date | null): Promise<void> {
    await OutboxJobModel.findOneAndUpdate(
      { _id: id, status: 'RUNNING' },
      {
        $set: {
          status: nextRunAt ? 'PENDING' : 'FAILED',
          lockedAt: null,
          lockedBy: null,
          lastError,
          updatedAt: new Date(),
          ...(nextRunAt ? { runAt: nextRunAt } : {}),
        },
        $inc: {
          attempts: 1,
          consecutiveFailureCount: 1,
        },
      },
    ).exec();
  }

  public async findPendingByOrderAndType(orderId: string, jobType: JobType): Promise<OutboxJob | null> {
    const document = await OutboxJobModel.findOne({
      orderId,
      jobType,
      status: { $in: ['PENDING', 'RUNNING'] },
    })
      .sort({ createdAt: -1 })
      .exec();

    return document ? toDomainEntity<OutboxJob>(document) : null;
  }

  public async findPendingByProviderEventAndType(
    providerEventId: string,
    jobType: JobType,
  ): Promise<OutboxJob | null> {
    const document = await OutboxJobModel.findOne({
      providerEventId,
      jobType,
      status: { $in: ['PENDING', 'RUNNING'] },
    })
      .sort({ createdAt: -1 })
      .exec();

    return document ? toDomainEntity<OutboxJob>(document) : null;
  }

  public async reschedulePendingByOrderAndType(
    orderId: string,
    jobType: JobType,
    runAt: Date,
  ): Promise<OutboxJob | null> {
    const document = await OutboxJobModel.findOneAndUpdate(
      {
        orderId,
        jobType,
        status: 'PENDING',
      },
      {
        $set: {
          runAt,
        },
      },
      {
        returnDocument: 'after',
      },
    ).exec();

    return document ? toDomainEntity<OutboxJob>(document) : null;
  }

  public async listByStatus(status: OutboxJobStatus): Promise<OutboxJob[]> {
    const documents = await OutboxJobModel.find({ status }).sort({ runAt: 1 }).exec();
    return documents.map((document) => toDomainEntity<OutboxJob>(document));
  }
}
