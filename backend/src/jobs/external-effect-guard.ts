import type { FastifyBaseLogger } from 'fastify';

import { AppError } from '../app/errors/app-error';
import { TERMINAL_ORDER_STATUSES, type OrderStatus } from '../domain/enums/order-status';
import type { OutboxJobRepository } from '../domain/repositories/outbox-job.repository';
import type { OrderRepository } from '../domain/repositories/order.repository';
import { EnergyRequestModel } from '../infrastructure/db/models/energy-request.model';
import { ForwardRequestModel } from '../infrastructure/db/models/forward-request.model';
import { SendRequestModel } from '../infrastructure/db/models/send-request.model';
import type { MongoLockService } from '../infrastructure/locks/mongo-lock.service';
import type {
  FinancialExternalOperationType,
  FinancialJobExecutionContext,
} from './financial-job-execution-context';

const BLOCKING_REQUEST_STATUSES = [
  'PENDING',
  'REQUESTED',
  'ACCEPTED',
  'BROADCASTED',
  'CONFIRMED',
  'OUTCOME_UNKNOWN',
];

interface ExternalEffectGuardDependencies {
  logger: FastifyBaseLogger;
  lockService: MongoLockService;
  outboxJobRepository: OutboxJobRepository;
  orderRepository: OrderRepository;
}

interface ExternalEffectGuardOptions {
  operationType: FinancialExternalOperationType;
  allowedOrderStatuses: OrderStatus[];
  allowedRequestId?: string | null;
}

export class ExternalEffectGuard {
  public constructor(private readonly dependencies: ExternalEffectGuardDependencies) {}

  public async assertExternalEffectStillAllowed(
    context: FinancialJobExecutionContext,
    options: ExternalEffectGuardOptions,
  ): Promise<void> {
    if (context.abortSignal?.aborted) {
      this.block(context, options.operationType, 'ABORTED_BEFORE_EXTERNAL_EFFECT');
    }

    const now = new Date();
    const [job, leader, order] = await Promise.all([
      this.dependencies.outboxJobRepository.findById(context.jobId),
      this.dependencies.lockService.getLeader('scheduler:leader'),
      this.dependencies.orderRepository.findByOrderId(context.orderId),
    ]);

    if (
      !job ||
      job.status !== 'RUNNING' ||
      job.lockedBy !== context.workerId ||
      job.claimedBootId !== context.bootId ||
      job.leaderOwnerId !== context.leaderOwnerId ||
      job.leaderFencingToken !== context.leaderFencingToken ||
      job.cancelRequestedAt != null ||
      job.interruptedAt != null ||
      (job.recoveryGeneration ?? 0) !== context.recoveryGeneration
    ) {
      this.block(context, options.operationType, 'JOB_NOT_AUTHORIZED_FOR_EXTERNAL_EFFECT');
    }

    if (
      !leader ||
      leader.leaseId !== context.leaseId ||
      leader.ownerId !== context.leaderOwnerId ||
      leader.bootId !== context.bootId ||
      leader.fencingToken !== context.leaderFencingToken ||
      leader.expiresAt.getTime() <= now.getTime()
    ) {
      this.block(context, options.operationType, 'LEADERSHIP_NOT_AUTHORIZED_FOR_EXTERNAL_EFFECT');
    }

    if (
      !order ||
      order.manualReviewRequired === true ||
      order.resolvedManually === true ||
      TERMINAL_ORDER_STATUSES.includes(order.status) ||
      !options.allowedOrderStatuses.includes(order.status) ||
      (order.recoveryGeneration ?? 0) !== context.recoveryGeneration
    ) {
      this.block(context, options.operationType, 'ORDER_NOT_AUTHORIZED_FOR_EXTERNAL_EFFECT', {
        orderStatus: order?.status ?? null,
        orderRecoveryGeneration: order?.recoveryGeneration ?? 0,
      });
    }

    if (await this.hasBlockingRequest(context, options)) {
      this.block(context, options.operationType, 'BLOCKING_REQUEST_EXISTS');
    }
  }

  private async hasBlockingRequest(
    context: FinancialJobExecutionContext,
    options: ExternalEffectGuardOptions,
  ): Promise<boolean> {
    const allowedId = options.allowedRequestId ?? null;
    const idFilter = allowedId ? { _id: { $ne: allowedId } } : {};

    if (options.operationType === 'ENERGY') {
      return Boolean(
        await EnergyRequestModel.exists({
          orderId: context.orderId,
          status: { $in: BLOCKING_REQUEST_STATUSES },
          ...idFilter,
        }).exec(),
      );
    }

    if (options.operationType === 'FORWARD') {
      return Boolean(
        await ForwardRequestModel.exists({
          orderId: context.orderId,
          status: { $in: BLOCKING_REQUEST_STATUSES },
          ...idFilter,
        }).exec(),
      );
    }

    return Boolean(
      await SendRequestModel.exists({
        orderId: context.orderId,
        status: { $in: BLOCKING_REQUEST_STATUSES },
        ...idFilter,
      }).exec(),
    );
  }

  private block(
    context: FinancialJobExecutionContext,
    operationType: FinancialExternalOperationType,
    reasonCode: string,
    details?: Record<string, unknown>,
  ): never {
    this.dependencies.logger.warn(
      {
        jobId: context.jobId,
        jobType: context.jobType,
        orderId: context.orderId,
        bootId: context.bootId,
        workerId: context.workerId,
        leaderOwnerId: context.leaderOwnerId,
        leaderFencingToken: context.leaderFencingToken,
        recoveryGeneration: context.recoveryGeneration,
        operationType,
        reasonCode,
        ...(details ?? {}),
      },
      'external_effect_guard_blocked',
    );

    throw new AppError({
      code: 'EXTERNAL_EFFECT_GUARD_BLOCKED',
      statusCode: 409,
      message: 'La operacion externa fue bloqueada por fencing, cancelacion o estado no autorizado.',
      details: {
        reasonCode,
        operationType,
      },
    });
  }
}
