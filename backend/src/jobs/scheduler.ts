import type { OutboxJob } from '../domain/entities/outbox-job.entity';
import type { OutboxJobRepository } from '../domain/repositories/outbox-job.repository';
import { AppError } from '../app/errors/app-error';
import { calculateExponentialBackoff } from '../shared/utils/backoff';
import { JOB_TYPES } from '../shared/constants/job-types';
import type { ActorContext } from '../shared/types/actor';
import type { EnergyService } from '../modules/energy/energy.service';
import type { ForwardsService } from '../modules/forwards/forwards.service';
import type { OrdersService } from '../modules/orders/orders.service';
import type { ProviderEventsService } from '../modules/provider-events/provider-events.service';
import type { ReconciliationService } from '../modules/reconciliation/reconciliation.service';
import type { MongoLockService } from '../infrastructure/locks/mongo-lock.service';
import type { LeaderLock } from '../infrastructure/locks/mongo-lock.service';
import type { AppConfig } from '../app/config/env';
import type { BootContext } from '../app/boot-context';
import type { FastifyBaseLogger } from 'fastify';
import { TERMINAL_ORDER_STATUSES } from '../domain/enums/order-status';
import type { FinancialJobExecutionContext } from './financial-job-execution-context';

interface SchedulerDependencies {
  config: AppConfig;
  logger: FastifyBaseLogger;
  outboxJobRepository: OutboxJobRepository;
  ordersService: OrdersService;
  energyService: EnergyService;
  forwardsService: ForwardsService;
  providerEventsService: ProviderEventsService;
  reconciliationService: ReconciliationService;
  lockService: MongoLockService;
  bootContext: BootContext;
}

const RESTART_REVIEW_REASON = 'SERVER_RESTART_REQUIRES_MANUAL_REVIEW';
const SCHEDULER_LEADER_LOCK = 'scheduler:leader';
const LEADERSHIP_RETRY_MS = 4_000;
const ACTIVE_EXECUTION_STOP_TIMEOUT_MS = 10_000;
type SchedulerState = 'STOPPED' | 'WAITING_FOR_LEADERSHIP' | 'LEADER' | 'LOST_LEADERSHIP';

interface ActiveJobExecution {
  abortController: AbortController;
  startedAt: Date;
  context: FinancialJobExecutionContext;
  promise: Promise<void>;
}

export class MongoScheduler {
  private timer: NodeJS.Timeout | null = null;
  private leaderHeartbeatTimer: NodeJS.Timeout | null = null;
  private leadershipRetryTimer: NodeJS.Timeout | null = null;
  private leaderLock: LeaderLock | null = null;
  private state: SchedulerState = 'STOPPED';
  private activeExecutions = new Map<string, ActiveJobExecution>();
  private initialBootRecoveryCompleted = false;
  private stopping = false;

  private running = false;

  public constructor(private readonly dependencies: SchedulerDependencies) {}

  public async start(): Promise<void> {
    if (!this.dependencies.config.scheduler.enabled || this.state === 'LEADER') {
      return;
    }

    await this.tryAcquireLeadership();
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    this.state = 'STOPPED';
    if (this.leadershipRetryTimer) {
      clearTimeout(this.leadershipRetryTimer);
      this.leadershipRetryTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.leaderHeartbeatTimer) {
      clearInterval(this.leaderHeartbeatTimer);
      this.leaderHeartbeatTimer = null;
    }
    await this.abortActiveExecutions('scheduler_stopped');
    if (this.leaderLock) {
      await this.dependencies.lockService.releaseLeader(this.leaderLock);
      this.leaderLock = null;
    }
    this.stopping = false;
  }

  private async tryAcquireLeadership(): Promise<void> {
    if (this.state === 'STOPPED' && !this.dependencies.config.scheduler.enabled) {
      return;
    }

    const leaderLock = await this.dependencies.lockService.acquireLeader(
      SCHEDULER_LEADER_LOCK,
      this.dependencies.bootContext.bootId,
    );
    if (!leaderLock) {
      this.state = 'WAITING_FOR_LEADERSHIP';
      this.dependencies.logger.warn(
        {
          bootId: this.dependencies.bootContext.bootId,
        },
        'scheduler_waiting_for_leadership',
      );
      this.scheduleLeadershipRetry();
      return;
    }

    const reacquired = this.state === 'LOST_LEADERSHIP' || this.state === 'WAITING_FOR_LEADERSHIP';
    this.leaderLock = leaderLock;
    this.state = 'LEADER';
    this.dependencies.logger.info(
      {
        bootId: this.dependencies.bootContext.bootId,
        workerId: leaderLock.ownerId,
        fencingToken: leaderLock.fencingToken,
      },
      reacquired ? 'scheduler_leadership_reacquired' : 'scheduler_leadership_acquired',
    );

    this.startLeaderHeartbeat();
    if (!this.initialBootRecoveryCompleted) {
      await this.interruptInheritedJobsOnBoot();
      await this.completePendingStartupQuarantines();
      await this.dependencies.reconciliationService.quarantineLegacyOpenOrders({
        actorType: 'scheduler',
        actorId: `boot:${this.dependencies.bootContext.bootId}`,
      });
      this.initialBootRecoveryCompleted = true;
    }

    await this.dependencies.reconciliationService.seedPendingJobs();
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      void this.runTick();
    }, this.dependencies.config.scheduler.pollMs);
  }

  public async runTick(): Promise<void> {
    const directTestTick = this.canRunDirectTickForTests();
    if (this.running || (!directTestTick && (this.state !== 'LEADER' || !this.leaderLock))) {
      return;
    }

    this.running = true;
    try {
      while (true) {
        if (
          !directTestTick &&
          (this.state !== 'LEADER' || this.leaderLock == null || this.stopping)
        ) {
          break;
        }
        const lease = this.leaderLock;
        if (!directTestTick && !lease) {
          break;
        }
        const activeLease = lease;

        const dueJob = await this.dependencies.outboxJobRepository.findDueJob(new Date());
        if (!dueJob?.id) {
          break;
        }

        const recoveryGeneration = dueJob.orderId
          ? (await this.dependencies.ordersService.getInternalOrder(dueJob.orderId).catch(() => null))
              ?.recoveryGeneration ?? 0
          : 0;
        const claimedJob = await this.dependencies.outboxJobRepository.claimJob(
          dueJob.id,
          new Date(),
          this.dependencies.bootContext.bootId,
          directTestTick
            ? undefined
            : {
                ownerId: activeLease!.ownerId,
                fencingToken: activeLease!.fencingToken,
              },
          recoveryGeneration,
        );
        if (!claimedJob?.id) {
          continue;
        }

        try {
          const leadershipStillValid = directTestTick
            ? true
            : await this.assertLeadershipStillValidForJob(claimedJob);
          if (!leadershipStillValid) {
            await this.dependencies.outboxJobRepository.interruptJob(
              claimedJob.id,
              this.dependencies.bootContext.bootId,
              'LEADERSHIP_LOST_BEFORE_EXECUTION',
            );
            break;
          }
          await this.runActiveExecution(claimedJob, recoveryGeneration);
          if (
            claimedJob.orderId &&
            claimedJob.jobType === JOB_TYPES.RECONCILE_ORDER
          ) {
            const nextRunAt =
              await this.dependencies.reconciliationService.getNextReconciliationRunAtIfNeeded(
                claimedJob.orderId,
              );
            if (nextRunAt) {
              const rescheduled =
                await this.dependencies.outboxJobRepository.rescheduleRunningReconcileJob(
                  claimedJob.id,
                  this.dependencies.bootContext.bootId,
                  nextRunAt,
                );
              if (rescheduled) {
                this.dependencies.logger.info(
                  {
                    orderId: claimedJob.orderId,
                    jobId: claimedJob.id,
                    jobType: claimedJob.jobType,
                    bootId: this.dependencies.bootContext.bootId,
                  },
                  'reconcile_job_reschedules',
                );
              }
              continue;
            }
          }

          await this.dependencies.outboxJobRepository.completeJob(
            claimedJob.id,
            this.buildOutboxCompletedPurgeAt(),
          );
          if (claimedJob.orderId && claimedJob.jobType === JOB_TYPES.EXPIRE_ORDER) {
            await this.dependencies.reconciliationService.scheduleReconciliationIfNeeded(
              claimedJob.orderId,
            );
          }
        } catch (error) {
          await this.handleJobFailure(claimedJob, error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async interruptInheritedJobsOnBoot(): Promise<void> {
    const interruptedAt = new Date();
    const interruptedJobs =
      await this.dependencies.outboxJobRepository.interruptActiveJobsFromPreviousBoot({
        bootId: this.dependencies.bootContext.bootId,
        interruptedAt,
        reason: RESTART_REVIEW_REASON,
      });

    if (interruptedJobs.length === 0) {
      return;
    }

    this.dependencies.logger.warn(
      {
        jobsInterrupted: interruptedJobs.length,
        bootId: this.dependencies.bootContext.bootId,
        reasonCode: RESTART_REVIEW_REASON,
      },
      'jobs_interrupted_on_boot',
    );

    await this.applyManualReviewForInterruptedJobs(interruptedJobs, interruptedAt);
  }

  private async completePendingStartupQuarantines(): Promise<void> {
    const pendingJobs = await this.dependencies.outboxJobRepository.listInterruptedPendingQuarantine();
    if (pendingJobs.length === 0) {
      return;
    }

    await this.applyManualReviewForInterruptedJobs(pendingJobs, new Date());
    this.dependencies.logger.warn(
      {
        jobsInterrupted: pendingJobs.length,
        bootId: this.dependencies.bootContext.bootId,
      },
      'startup_quarantine_recovered',
    );
  }

  private async applyManualReviewForInterruptedJobs(
    jobs: OutboxJob[],
    appliedAt: Date,
  ): Promise<void> {
    const jobsByOrderId = new Map<string, OutboxJob[]>();
    for (const job of jobs) {
      if (!job.orderId) {
        if (job.id) {
          await this.dependencies.outboxJobRepository.markQuarantineApplied(
            [job.id],
            null,
            appliedAt,
          );
        }
        continue;
      }
      jobsByOrderId.set(job.orderId, [...(jobsByOrderId.get(job.orderId) ?? []), job]);
    }

    const actor: ActorContext = {
      actorType: 'scheduler',
      actorId: `boot:${this.dependencies.bootContext.bootId}`,
    };

    for (const [orderId, jobs] of jobsByOrderId) {
      const order = await this.dependencies.ordersService.getInternalOrder(orderId).catch(() => null);
      const jobIds = jobs.map((job) => job.id).filter((id): id is string => typeof id === 'string');
      if (!order || TERMINAL_ORDER_STATUSES.includes(order.status)) {
        await this.dependencies.outboxJobRepository.markQuarantineApplied(
          jobIds,
          orderId,
          appliedAt,
        );
        continue;
      }

      try {
        await this.dependencies.ordersService.markStartupManualReview(
          order,
          actor,
          this.dependencies.bootContext.bootId,
          appliedAt,
          jobIds,
        );
        await this.dependencies.outboxJobRepository.markQuarantineApplied(
          jobIds,
          orderId,
          appliedAt,
        );
      } catch (error) {
        await this.dependencies.outboxJobRepository.markQuarantineFailed(
          jobIds,
          error instanceof Error ? error.message : 'unknown_quarantine_error',
        );
        throw error;
      }

      this.dependencies.logger.warn(
        {
          orderId,
          bootId: this.dependencies.bootContext.bootId,
          previousStatus: order.status,
          newStatus: 'ERROR_MANUAL_REVIEW',
          reasonCode: RESTART_REVIEW_REASON,
        },
        'orders_moved_to_manual_review',
      );
    }

    this.dependencies.logger.warn(
      {
        bootId: this.dependencies.bootContext.bootId,
      },
      'startup_quarantine_completed',
    );
  }

  private async executeJob(
    job: OutboxJob,
    executionContext?: FinancialJobExecutionContext,
  ): Promise<void> {
    const actor: ActorContext = {
      actorType: 'scheduler',
      actorId: job.id ?? 'scheduler-job',
    };

    switch (job.jobType) {
      case JOB_TYPES.EXPIRE_ORDER:
        if (!job.orderId) {
          return;
        }
        await this.dependencies.ordersService.expireOrderIfNeeded(job.orderId, actor);
        return;
      case JOB_TYPES.REQUEST_ENERGY:
        if (!job.orderId) {
          return;
        }
        if (!executionContext && !this.canRunDirectTickForTests()) {
          throw new AppError({
            code: 'EXTERNAL_EFFECT_CONTEXT_REQUIRED',
            statusCode: 500,
            message: 'El job financiero no tiene contexto de ejecucion.',
          });
        }
        await this.dependencies.energyService.requestEnergy(job.orderId, actor, executionContext);
        return;
      case JOB_TYPES.REQUEST_BUY_ENERGY:
        if (!job.orderId) {
          return;
        }
        if (!executionContext && !this.canRunDirectTickForTests()) {
          throw new AppError({
            code: 'EXTERNAL_EFFECT_CONTEXT_REQUIRED',
            statusCode: 500,
            message: 'El job financiero no tiene contexto de ejecucion.',
          });
        }
        await this.dependencies.energyService.requestBuyEnergy(job.orderId, actor, executionContext);
        return;
      case JOB_TYPES.REQUEST_FORWARD:
        if (!job.orderId) {
          return;
        }
        if (!executionContext && !this.canRunDirectTickForTests()) {
          throw new AppError({
            code: 'EXTERNAL_EFFECT_CONTEXT_REQUIRED',
            statusCode: 500,
            message: 'El job financiero no tiene contexto de ejecucion.',
          });
        }
        await this.dependencies.forwardsService.requestForward(job.orderId, actor, executionContext);
        return;
      case JOB_TYPES.SEND_BUY:
        if (!job.orderId) {
          return;
        }
        if (!executionContext && !this.canRunDirectTickForTests()) {
          throw new AppError({
            code: 'EXTERNAL_EFFECT_CONTEXT_REQUIRED',
            statusCode: 500,
            message: 'El job financiero no tiene contexto de ejecucion.',
          });
        }
        await this.dependencies.forwardsService.requestBuySend(job.orderId, actor, executionContext);
        return;
      case JOB_TYPES.RECONCILE_ORDER:
        if (!job.orderId) {
          return;
        }
        await this.dependencies.reconciliationService.reconcileOrder(job.orderId, actor);
        return;
      case JOB_TYPES.REPROCESS_PROVIDER_EVENT:
        if (typeof job.providerEventId !== 'string' && typeof job.payload['providerEventId'] !== 'string') {
          return;
        }
        await this.dependencies.providerEventsService.reprocessEvent(
          typeof job.providerEventId === 'string'
            ? job.providerEventId
            : (job.payload['providerEventId'] as string),
        );
        return;
      case JOB_TYPES.MARK_MANUAL_REVIEW:
        if (!job.orderId) {
          return;
        }
        await this.dependencies.ordersService.markManualReview(
          job.orderId,
          actor,
          typeof job.payload['reason'] === 'string'
            ? job.payload['reason']
            : 'La orden requiere revisión manual tras agotar reintentos automáticos.',
          job.payload,
        );
        return;
      default:
        return;
    }
  }

  private async handleJobFailure(job: OutboxJob, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    const nextAttempts = (job.attempts ?? 0) + 1;
    const shouldRetry = nextAttempts < job.maxAttempts;

    this.dependencies.logger.warn(
      {
        jobId: job.id,
        jobType: job.jobType,
        orderId: job.orderId,
        attempts: job.attempts,
        err: error,
      },
      'Fallo procesando job de outbox',
    );

    if (job.jobType === JOB_TYPES.MARK_MANUAL_REVIEW) {
      await this.dependencies.outboxJobRepository.failJob(job.id as string, message, null);
      this.dependencies.logger.error(
        {
          jobId: job.id,
          jobType: job.jobType,
          orderId: job.orderId,
          bootId: this.dependencies.bootContext.bootId,
          reasonCode: 'MARK_MANUAL_REVIEW_RECURSION_BLOCKED',
        },
        'manual_review_job_recursion_blocked',
      );
      return;
    }

    if (error instanceof AppError && error.code === 'EXTERNAL_EFFECT_GUARD_BLOCKED') {
      await this.dependencies.outboxJobRepository.failJob(job.id as string, message, null);
      return;
    }

    if (shouldRetry) {
      const nextRunAt = new Date(
        Date.now() +
          (error instanceof AppError && error.code === 'LOCK_NOT_ACQUIRED'
            ? this.dependencies.config.scheduler.pollMs
            : calculateExponentialBackoff(
                nextAttempts,
                this.resolveBackoffMs(job),
              )),
      );

      await this.dependencies.outboxJobRepository.failJob(job.id as string, message, nextRunAt);
      return;
    }

    await this.dependencies.outboxJobRepository.failJob(job.id as string, message, null);

    if (job.orderId && job.jobType !== JOB_TYPES.REPROCESS_PROVIDER_EVENT) {
      const existingManualReview = await this.dependencies.outboxJobRepository.findPendingByOrderAndType(
        job.orderId,
        JOB_TYPES.MARK_MANUAL_REVIEW,
      );
      if (existingManualReview) {
        return;
      }

      await this.dependencies.outboxJobRepository.enqueue({
        jobType: JOB_TYPES.MARK_MANUAL_REVIEW,
        orderId: job.orderId,
        providerEventId: null,
        payload: {
          reason: `Se agotaron los reintentos del job ${job.jobType}.`,
          parentJobId: job.id,
          parentJobType: job.jobType,
          recursionGuard: true,
        },
        status: 'PENDING',
        runAt: new Date(),
        attempts: 0,
        maxAttempts: 1,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        createdBootId: this.dependencies.bootContext.bootId,
        claimedBootId: null,
        lastBootId: this.dependencies.bootContext.bootId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  private resolveBackoffMs(job: OutboxJob): number {
    if (job.jobType === JOB_TYPES.REQUEST_FORWARD) {
      return this.dependencies.config.forward.retryBackoffMs;
    }

    if (job.jobType === JOB_TYPES.REQUEST_BUY_ENERGY || job.jobType === JOB_TYPES.SEND_BUY) {
      return this.dependencies.config.buy.retryBackoffMs;
    }

    return this.dependencies.config.forward.retryBackoffMs;
  }

  private buildOutboxCompletedPurgeAt(): Date {
    return new Date(
      Date.now() +
        this.dependencies.config.retention.outboxCompletedRetentionDays * 24 * 60 * 60 * 1_000,
    );
  }

  private startLeaderHeartbeat(): void {
    if (this.leaderHeartbeatTimer) {
      clearInterval(this.leaderHeartbeatTimer);
    }
    const intervalMs = Math.max(1_000, Math.floor((this.dependencies.config.locks.ttlSec * 1_000) / 3));
    this.leaderHeartbeatTimer = setInterval(() => {
      void this.renewLeader();
    }, intervalMs);
  }

  private async renewLeader(): Promise<void> {
    if (!this.leaderLock) {
      return;
    }

    const renewed = await this.dependencies.lockService.renewLeader(this.leaderLock);
    if (!renewed) {
      this.dependencies.logger.error(
        {
          bootId: this.dependencies.bootContext.bootId,
          workerId: this.leaderLock.ownerId,
          fencingToken: this.leaderLock.fencingToken,
        },
        'scheduler_leadership_lost',
      );
      this.state = 'LOST_LEADERSHIP';
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      if (this.leaderHeartbeatTimer) {
        clearInterval(this.leaderHeartbeatTimer);
        this.leaderHeartbeatTimer = null;
      }
      this.leaderLock = null;
      await this.abortActiveExecutions('scheduler_leadership_lost');
      this.scheduleLeadershipRetry();
      return;
    }

    this.leaderLock = renewed;
  }

  private async assertLeadershipStillValidForJob(job: OutboxJob): Promise<boolean> {
    if (!this.leaderLock) {
      return false;
    }

    const currentLeader = await this.dependencies.lockService.getLeader(SCHEDULER_LEADER_LOCK);
    const valid =
      Boolean(currentLeader) &&
      currentLeader?.leaseId === this.leaderLock.leaseId &&
      currentLeader?.ownerId === this.leaderLock.ownerId &&
      currentLeader?.bootId === this.leaderLock.bootId &&
      currentLeader?.fencingToken === this.leaderLock.fencingToken &&
      job.leaderOwnerId === this.leaderLock.ownerId &&
      job.leaderFencingToken === this.leaderLock.fencingToken &&
      job.status === 'RUNNING' &&
      job.lockedBy === this.dependencies.bootContext.bootId;

    if (!valid) {
      this.dependencies.logger.warn(
        {
          orderId: job.orderId,
          jobId: job.id,
          jobType: job.jobType,
          bootId: this.dependencies.bootContext.bootId,
          workerId: this.leaderLock.ownerId,
          fencingToken: this.leaderLock.fencingToken,
          reasonCode: 'STALE_FENCING_TOKEN',
        },
        'stale_fencing_token_blocked',
      );
    }

    return valid;
  }

  private canRunDirectTickForTests(): boolean {
    return this.dependencies.config.nodeEnv === 'test' && !this.dependencies.config.scheduler.enabled;
  }

  private scheduleLeadershipRetry(): void {
    if (this.leadershipRetryTimer || this.state === 'STOPPED') {
      return;
    }

    this.leadershipRetryTimer = setTimeout(() => {
      this.leadershipRetryTimer = null;
      void this.tryAcquireLeadership();
    }, LEADERSHIP_RETRY_MS);
  }

  private buildExecutionContext(
    job: OutboxJob,
    recoveryGeneration: number,
    abortSignal: AbortSignal,
  ): FinancialJobExecutionContext | undefined {
    if (!job.id || !job.orderId || !this.leaderLock) {
      return undefined;
    }

    return {
      jobId: job.id,
      jobType: job.jobType,
      orderId: job.orderId,
      workerId: this.dependencies.bootContext.bootId,
      bootId: this.dependencies.bootContext.bootId,
      leaseId: this.leaderLock.leaseId,
      leaderOwnerId: this.leaderLock.ownerId,
      leaderFencingToken: this.leaderLock.fencingToken,
      recoveryGeneration,
      abortSignal,
    };
  }

  private async runActiveExecution(
    job: OutboxJob,
    recoveryGeneration: number,
  ): Promise<void> {
    if (!job.id) {
      await this.executeJob(job, undefined);
      return;
    }

    const abortController = new AbortController();
    const context = this.buildExecutionContext(job, recoveryGeneration, abortController.signal);
    if (!context) {
      await this.executeJob(job, undefined);
      return;
    }

    const promise = this.executeJob(job, context);
    this.activeExecutions.set(job.id, {
      abortController,
      startedAt: new Date(),
      context,
      promise,
    });

    try {
      await promise;
    } finally {
      this.activeExecutions.delete(job.id);
    }
  }

  private async abortActiveExecutions(reason: string): Promise<void> {
    const executions = [...this.activeExecutions.values()];
    if (executions.length === 0) {
      return;
    }

    for (const execution of executions) {
      execution.abortController.abort(reason);
    }

    await Promise.race([
      Promise.allSettled(executions.map((execution) => execution.promise)),
      new Promise((resolve) => setTimeout(resolve, ACTIVE_EXECUTION_STOP_TIMEOUT_MS)),
    ]);
  }
}
