import { randomUUID } from 'node:crypto';
import { MongoServerError } from 'mongodb';

import type { OutboxJob } from '../../domain/entities/outbox-job.entity';
import type { OutboxJobRepository } from '../../domain/repositories/outbox-job.repository';
import type { JobType } from '../../shared/constants/job-types';
import type { BootContext } from '../../app/boot-context';

export class OutboxService {
  public constructor(
    private readonly repository: OutboxJobRepository,
    private readonly bootContext?: BootContext,
  ) {}

  public async enqueue(params: {
    jobType: JobType;
    orderId: string | null;
    providerEventId?: string | null;
    payload?: Record<string, unknown>;
    runAt?: Date;
    maxAttempts?: number;
    recoveryGeneration?: number | null;
  }): Promise<OutboxJob> {
    return this.repository.enqueue({
      jobType: params.jobType,
      orderId: params.orderId,
      providerEventId: params.providerEventId ?? null,
      payload: {
        jobId: randomUUID(),
        ...(params.payload ?? {}),
      },
      status: 'PENDING',
      runAt: params.runAt ?? new Date(),
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 5,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      recoveryGeneration: params.recoveryGeneration ?? null,
      createdBootId: this.bootContext?.bootId ?? null,
      claimedBootId: null,
      lastBootId: this.bootContext?.bootId ?? null,
      interruptedAt: null,
      interruptedByBootId: null,
      interruptionReason: null,
      purgeAt: null,
      executionCount: 0,
      lastRunAt: null,
      lastSuccessAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  public async enqueueUnique(params: {
    jobType: JobType;
    orderId: string;
    payload?: Record<string, unknown>;
    runAt?: Date;
    maxAttempts?: number;
    recoveryGeneration?: number | null;
  }): Promise<OutboxJob> {
    const existing = await this.repository.findPendingByOrderAndType(params.orderId, params.jobType);
    if (existing) {
      return existing;
    }

    try {
      return await this.enqueue(params);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrentExisting = await this.repository.findPendingByOrderAndType(
          params.orderId,
          params.jobType,
        );

        if (concurrentExisting) {
          return concurrentExisting;
        }
      }

      throw error;
    }
  }

  public async enqueueUniqueProviderEvent(params: {
    jobType: JobType;
    providerEventId: string;
    orderId: string | null;
    payload?: Record<string, unknown>;
    runAt?: Date;
    maxAttempts?: number;
    recoveryGeneration?: number | null;
  }): Promise<OutboxJob> {
    const existing = await this.repository.findPendingByProviderEventAndType(
      params.providerEventId,
      params.jobType,
    );
    if (existing) {
      return existing;
    }

    try {
      return await this.enqueue({
        jobType: params.jobType,
        orderId: params.orderId,
        providerEventId: params.providerEventId,
        payload: {
          ...(params.payload ?? {}),
          providerEventId: params.providerEventId,
          orderId: params.orderId,
        },
        runAt: params.runAt,
        maxAttempts: params.maxAttempts,
        recoveryGeneration: params.recoveryGeneration,
      });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrentExisting = await this.repository.findPendingByProviderEventAndType(
          params.providerEventId,
          params.jobType,
        );

        if (concurrentExisting) {
          return concurrentExisting;
        }
      }

      throw error;
    }
  }

  public async enqueueUniqueNow(params: {
    jobType: JobType;
    orderId: string;
    payload?: Record<string, unknown>;
    maxAttempts?: number;
    recoveryGeneration?: number | null;
  }): Promise<OutboxJob> {
    const now = new Date();
    const existing = await this.repository.findPendingByOrderAndType(params.orderId, params.jobType);
    if (existing) {
      if (existing.status === 'PENDING' && existing.runAt.getTime() > now.getTime()) {
        const rescheduled = await this.repository.reschedulePendingByOrderAndType(
          params.orderId,
          params.jobType,
          now,
        );

        return rescheduled ?? existing;
      }

      return existing;
    }

    return this.enqueueUnique({
      ...params,
      runAt: now,
    });
  }

  public async cancelActiveJobsForOrder(
    orderId: string,
    reason: string,
    actorId: string,
  ): Promise<number> {
    return this.repository.cancelActiveJobsForOrder(orderId, reason, actorId);
  }
}
