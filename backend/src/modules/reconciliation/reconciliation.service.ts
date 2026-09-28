import type { FastifyBaseLogger } from 'fastify';
import type { BootContext } from '../../app/boot-context';

import type { AppConfig } from '../../app/config/env';
import { AppError } from '../../app/errors/app-error';
import type { Order } from '../../domain/entities/order.entity';
import type { OrderRepository } from '../../domain/repositories/order.repository';
import type { ProviderEventRepository } from '../../domain/repositories/provider-event.repository';
import {
  validateDepositForOrder,
  type NormalizedDepositEvent,
} from '../../domain/services/deposit-validation.service';
import type {
  TronService,
  TronUsdtTransfer,
  TronUsdtTransferByTxid,
} from '../../infrastructure/blockchain/tron.service';
import type { MongoLockService } from '../../infrastructure/locks/mongo-lock.service';
import type { OutboxService } from '../../infrastructure/queue/outbox.service';
import { JOB_TYPES } from '../../shared/constants/job-types';
import type { ActorContext } from '../../shared/types/actor';
import type { EnergyService } from '../energy/energy.service';
import type { ForwardsService } from '../forwards/forwards.service';
import type { OrdersService } from '../orders/orders.service';

const WAITING_SELL_STATUSES = ['CREATED', 'ADDRESS_ASSIGNED', 'WAITING_DEPOSIT'] as const;
const RECONCILE_INTERVAL_MS = 10_000;
const SELL_POLLING_STATUSES = [
  'CREATED',
  'ADDRESS_ASSIGNED',
  'WAITING_DEPOSIT',
  'DEPOSIT_DETECTED',
  'ENERGY_ESTIMATION_REQUESTED',
  'ENERGY_ESTIMATED',
  'ENERGY_REQUESTED',
  'FORWARD_REQUESTED',
  'FORWARD_ACCEPTED',
] as const;
const BUY_POLLING_STATUSES = [
  'CREATED',
  'VALIDATED',
  'ENERGY_ESTIMATION_REQUESTED',
  'ENERGY_ESTIMATED',
  'ENERGY_REQUESTED',
  'SEND_REQUESTED',
  'SEND_ACCEPTED',
  'SEND_BROADCASTED',
] as const;

export class ReconciliationService {
  public constructor(
    private readonly config: AppConfig,
    private readonly orderRepository: OrderRepository,
    private readonly providerEventRepository: ProviderEventRepository,
    private readonly ordersService: OrdersService,
    private readonly outboxService: OutboxService,
    private readonly energyService: EnergyService,
    private readonly forwardsService: ForwardsService,
    private readonly tronService: TronService,
    private readonly lockService: MongoLockService,
    private readonly logger: FastifyBaseLogger,
    private readonly bootContext: BootContext,
  ) {}

  public async reconcileOrder(orderId: string, actor: ActorContext) {
    const lockLease = await this.lockService.acquireLease(`reconcile:${orderId}`);
    if (!lockLease) {
      throw new AppError({
        code: 'LOCK_NOT_ACQUIRED',
        statusCode: 409,
        message:
          'No fue posible adquirir el lock de reconciliacion para la orden solicitada.',
      });
    }

    try {
      let order = await this.ordersService.getOrderOrFail(orderId);
      const actions: string[] = [];

      if (order.type === 'SELL') {
        if (this.isWaitingSellStatus(order.status)) {
          const waitingResolution = await this.reconcileWaitingSellOrder(order, actor, actions);
          order = waitingResolution.order;

          if (
            this.isWaitingSellStatus(order.status) &&
            waitingResolution.allowExpiration &&
            order.expiresAt.getTime() <= Date.now()
          ) {
            const expiredOrder = await this.ordersService.expireOrderIfNeeded(orderId, actor);
            order = expiredOrder;
            actions.push('expired');
          } else if (
            this.isWaitingSellStatus(order.status) &&
            order.expiresAt.getTime() <= Date.now() &&
            !waitingResolution.allowExpiration
          ) {
            actions.push('expiration-deferred');
          }
        }

        if (
          order.status === 'DEPOSIT_DETECTED' ||
          order.status === 'ENERGY_ESTIMATION_REQUESTED' ||
          order.status === 'ENERGY_ESTIMATED' ||
          (order.status === 'ERROR_RETRYABLE' && !order.energyConfirmedAt)
        ) {
          await this.outboxService.enqueueUnique({
            jobType: JOB_TYPES.REQUEST_ENERGY,
            orderId,
            maxAttempts: this.config.energy.maxRetryCount,
          });
          actions.push('request-energy-enqueued');
          order = await this.ordersService.getOrderOrFail(orderId);
        }

        if (order.status === 'ENERGY_REQUESTED') {
          await this.energyService.reconcilePendingEnergy(orderId, actor);
          actions.push('itrx-order-query');
          order = await this.ordersService.getOrderOrFail(orderId);
        }

        if (
          order.status === 'ENERGY_CONFIRMED' ||
          (order.status === 'ERROR_RETRYABLE' && order.energyConfirmedAt)
        ) {
          await this.outboxService.enqueueUnique({
            jobType: JOB_TYPES.REQUEST_FORWARD,
            orderId,
            maxAttempts: this.config.forward.maxRetryCount,
          });
          actions.push('request-forward-enqueued');
          order = await this.ordersService.getOrderOrFail(orderId);
        }

        if (order.status === 'FORWARD_REQUESTED' || order.status === 'FORWARD_ACCEPTED') {
          await this.forwardsService.reconcilePendingForward(orderId, actor);
          actions.push('cryptocurrencyapi-status-query-forward');
          order = await this.ordersService.getOrderOrFail(orderId);
        }
      }

      if (order.type === 'BUY') {
        if (
          ['CREATED', 'VALIDATED', 'ENERGY_ESTIMATION_REQUESTED', 'ENERGY_ESTIMATED'].includes(
            order.status,
          ) ||
          (order.status === 'ERROR_RETRYABLE' && !order.energyConfirmedAt)
        ) {
          await this.outboxService.enqueueUnique({
            jobType: JOB_TYPES.REQUEST_BUY_ENERGY,
            orderId,
            maxAttempts: this.config.energy.maxRetryCount,
          });
          actions.push('request-buy-energy-enqueued');
          order = await this.ordersService.getOrderOrFail(orderId);
        }

        if (order.status === 'ENERGY_REQUESTED') {
          await this.energyService.reconcilePendingEnergy(orderId, actor);
          actions.push('itrx-order-query');
          order = await this.ordersService.getOrderOrFail(orderId);
        }

        if (
          order.status === 'ENERGY_CONFIRMED' ||
          (order.status === 'ERROR_RETRYABLE' && order.energyConfirmedAt)
        ) {
          await this.outboxService.enqueueUnique({
            jobType: JOB_TYPES.SEND_BUY,
            orderId,
            maxAttempts: this.config.buy.maxRetryCount,
          });
          actions.push('send-buy-enqueued');
          order = await this.ordersService.getOrderOrFail(orderId);
        }

        if (
          order.status === 'SEND_REQUESTED' ||
          order.status === 'SEND_ACCEPTED' ||
          order.status === 'SEND_BROADCASTED'
        ) {
          await this.forwardsService.reconcilePendingSend(orderId, actor);
          actions.push('cryptocurrencyapi-status-query-send');
          order = await this.ordersService.getOrderOrFail(orderId);
        }
      }

      if (order.status === 'READY_FOR_PAYOUT') {
        actions.push('ready-for-payout');
      }

      if (actor.actorType !== 'scheduler') {
        await this.scheduleReconciliationIfNeeded(order.orderId);
      }

      return {
        order,
        actions,
      };
    } finally {
      await this.lockService.releaseLease(lockLease);
    }
  }

  public async scheduleReconciliationIfNeeded(orderId: string): Promise<void> {
    const runAt = await this.getNextReconciliationRunAtIfNeeded(orderId);
    if (!runAt) {
      return;
    }

    await this.outboxService.enqueueUnique({
      jobType: JOB_TYPES.RECONCILE_ORDER,
      orderId,
      runAt,
      maxAttempts: 3,
    });
  }

  public async getNextReconciliationRunAtIfNeeded(orderId: string): Promise<Date | null> {
    const order = await this.ordersService.getOrderOrFail(orderId);
    if (!this.shouldContinuePolling(order)) {
      return null;
    }

    return this.buildNextReconcileRunAt();
  }

  public async seedPendingJobs(): Promise<void> {
    const expirableOrders = await this.orderRepository.findExpirableCreatedSince(
      new Date(),
      this.bootContext.bootStartedAt,
    );

    await Promise.all(
      expirableOrders.map((order) =>
        this.outboxService.enqueueUnique({
          jobType: JOB_TYPES.EXPIRE_ORDER,
          orderId: order.orderId,
          maxAttempts: 1,
        }),
      ),
    );

    this.logger.info(
      {
        bootPolicy: this.config.operations.interruptedOperationPolicy,
      },
      'provider_event_requeue_blocked',
    );
  }

  public async quarantineLegacyOpenOrders(actor: ActorContext): Promise<number> {
    const interruptedAt = new Date();
    let quarantined = 0;

    while (true) {
      const legacyOrders = await this.orderRepository.findLegacyOpenOrders({
        referenceDate: this.bootContext.bootStartedAt,
        limit: 500,
      });
      if (legacyOrders.length === 0) {
        break;
      }

      for (const order of legacyOrders) {
        await this.ordersService.markStartupManualReview(
          order,
          actor,
          this.bootContext.bootId,
          interruptedAt,
        );
        await this.outboxService.cancelActiveJobsForOrder(
          order.orderId,
          'LEGACY_OPEN_ORDER_REQUIRES_REVIEW',
          `${actor.actorType}:${actor.actorId}`,
        );
        quarantined += 1;
        this.logger.warn(
          {
            orderId: order.orderId,
            bootId: this.bootContext.bootId,
            previousStatus: order.status,
            newStatus: 'ERROR_MANUAL_REVIEW',
            reasonCode: 'SERVER_RESTART_REQUIRES_REVIEW',
          },
          'legacy_open_order_quarantined',
        );
      }

      this.logger.warn(
        {
          bootId: this.bootContext.bootId,
          batchSize: legacyOrders.length,
          quarantined,
        },
        'legacy_open_order_quarantine_batch_completed',
      );
    }

    return quarantined;
  }

  private async reconcileWaitingSellOrder(
    order: Order,
    actor: ActorContext,
    actions: string[],
  ): Promise<{ order: Order; allowExpiration: boolean }> {
    if (!order.depositAddress) {
      return {
        order,
        allowExpiration: true,
      };
    }

    if (order.cryptoAmountReceived !== null) {
      actions.push('deposit-already-recorded');
      return {
        order,
        allowExpiration: false,
      };
    }

    try {
      const transfer = await this.findSellDepositTransfer(order);

      if (transfer) {
        const normalizedExpectedAddress = this.tronService.normalizeAddress(order.depositAddress);
        const normalizedTransferAddress = this.tronService.normalizeAddress(transfer.to);
        if (normalizedTransferAddress !== normalizedExpectedAddress) {
          this.logger.warn(
            {
              orderId: order.orderId,
              txid: transfer.txid,
              internalStatus: order.status,
              confirmations: transfer.confirmations,
              requiredConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
              source: 'trongrid',
              expectedAddress: normalizedExpectedAddress,
              actualAddress: normalizedTransferAddress,
            },
            'cas_sell_deposit_address_mismatch',
          );

          if (order.depositObservedTxid === transfer.txid) {
            const manualReviewOrder = await this.ordersService.markManualReview(
              order.orderId,
              actor,
              'La transferencia observada no coincide con la direccion de deposito SELL esperada.',
              {
                source: 'trongrid-poll',
                txid: transfer.txid,
                expectedAddress: normalizedExpectedAddress,
                actualAddress: normalizedTransferAddress,
              },
            );
            actions.push('manual-review-required');
            return {
              order: await this.ordersService.getOrderOrFail(manualReviewOrder.orderId),
              allowExpiration: false,
            };
          }

          actions.push('trongrid-address-mismatch');
          return {
            order,
            allowExpiration: order.depositObservedAt === null,
          };
        }

        const observation = await this.ordersService.recordSellDepositObservation(order, {
          txid: transfer.txid,
          amount: transfer.amount,
          confirmations: transfer.confirmations,
          source: 'trongrid',
        });
        const observedOrder = observation.order;

        if (observation.conflict) {
          const manualReviewOrder = await this.ordersService.markManualReview(
            observedOrder.orderId,
            actor,
            'Se detecto un conflicto en la identidad del deposito SELL observado.',
            {
              source: 'trongrid-poll',
              observedTxid: observedOrder.depositObservedTxid,
              incomingTxid: transfer.txid,
              amount: transfer.amount,
              confirmations: transfer.confirmations,
              conflictReason: observation.reason ?? null,
            },
          );
          actions.push('manual-review-required');
          return {
            order: await this.ordersService.getOrderOrFail(manualReviewOrder.orderId),
            allowExpiration: false,
          };
        }

        const decision = validateDepositForOrder(observedOrder, this.buildDepositEvent(order, transfer), {
          minConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
          minOperationalUsdt: this.config.orders.minOperationalUsdt,
          allowPartialDeposits: this.config.orders.allowPartialDeposits,
          tolerancePercent: this.config.orders.amountTolerancePercent,
        });

        this.logger.info(
          {
            orderId: order.orderId,
            address: order.depositAddress,
            amount: transfer.amount,
            txid: transfer.txid,
            confirmations: transfer.confirmations,
          },
          'trongrid_deposit_detected',
        );

        actions.push('trongrid-deposit-detected');

        if (decision.nextStatus === 'ERROR_MANUAL_REVIEW') {
          const manualReviewOrder = await this.ordersService.markManualReview(
            order.orderId,
            actor,
            decision.reason,
            {
              source: 'trongrid-poll',
              amount: transfer.amount,
              txid: transfer.txid,
              from: transfer.from,
              timestamp: transfer.timestamp,
              confirmations: transfer.confirmations,
            },
          );

          await this.ordersService.patchOrder(order.orderId, {
            cryptoAmountReceived: transfer.amount,
            providerGiveRequestRaw: this.appendTronGridDetection(order, transfer),
          });

          actions.push('manual-review-required');
          return {
            order: await this.ordersService.getOrderOrFail(manualReviewOrder.orderId),
            allowExpiration: false,
          };
        }

        if (decision.accepted && observedOrder.status === 'WAITING_DEPOSIT') {
          const updatedOrder = await this.ordersService.transitionOrder(observedOrder, 'DEPOSIT_DETECTED', {
            actor,
            reason: `${decision.reason} Recuperado por reconciliacion activa on-chain via TronGrid.`,
            patch: {
              cryptoAmountReceived: decision.acceptedAmount,
              providerGiveRequestRaw: this.appendTronGridDetection(order, transfer),
            },
            metadata: {
              source: 'trongrid-poll',
              txid: transfer.txid,
              amount: transfer.amount,
              confirmations: transfer.confirmations,
              from: transfer.from,
              timestamp: transfer.timestamp,
            },
          });

          await this.outboxService.enqueueUnique({
            jobType: JOB_TYPES.REQUEST_ENERGY,
            orderId: order.orderId,
            maxAttempts: this.config.energy.maxRetryCount,
          });

          actions.push('deposit-detected-by-polling');
          actions.push('request-energy-enqueued');

          return {
            order: updatedOrder,
            allowExpiration: false,
          };
        }

        const staleObservedOrder = await this.maybeEscalateObservedDepositTimeout(
          observedOrder,
          actor,
          actions,
        );
        if (staleObservedOrder) {
          return {
            order: staleObservedOrder,
            allowExpiration: false,
          };
        }

        return {
          order: observedOrder,
          allowExpiration: false,
        };
      }

      const staleObservedOrder = await this.maybeEscalateObservedDepositTimeout(order, actor, actions);
      if (staleObservedOrder) {
        return {
          order: staleObservedOrder,
          allowExpiration: false,
        };
      }

      this.logger.info(
        {
          orderId: order.orderId,
          address: order.depositAddress,
        },
        'trongrid_no_deposit',
      );
      actions.push('trongrid-no-deposit');

      return {
        order,
        allowExpiration: order.depositObservedAt === null,
      };
    } catch (error) {
      this.logger.warn(
        {
          orderId: order.orderId,
          provider: 'trongrid',
          err: error,
        },
        'Fallo la consulta on-chain a TronGrid para deposito SELL; se difiere la expiracion',
      );
      actions.push('trongrid-query-failed');

      return {
        order,
        allowExpiration: false,
      };
    }
  }

  private buildDepositEvent(
    order: Order,
    transfer: TronUsdtTransferByTxid,
  ): NormalizedDepositEvent {
    return {
      address: transfer.to,
      label: order.providerLabel,
      uniqID: order.providerUniqId,
      txid: transfer.txid,
      token: this.config.tron.usdtTokenSymbol,
      network: 'TRON',
      amount: transfer.amount,
      confirmations: transfer.confirmations,
      status: transfer.confirmed ? 'deposit_confirmed' : 'deposit_pending',
      requestId: null,
      rawPayload: {
        source: 'trongrid',
        txid: transfer.txid,
        from: transfer.from,
        to: transfer.to,
        amount: transfer.amount,
        timestamp: transfer.timestamp,
        confirmations: transfer.confirmations,
      },
    };
  }

  private async findSellDepositTransfer(order: Order): Promise<TronUsdtTransferByTxid | null> {
    if (order.depositObservedTxid) {
      return this.tronService.getUSDTTransferByTxid(order.depositObservedTxid);
    }

    const transfers = await this.tronService.getUSDTTransfers(order.depositAddress as string, 20, {
      onlyConfirmed: false,
    });
    const transfer = this.selectSellDepositTransfer(order, transfers);
    if (!transfer) {
      return null;
    }

    return this.tronService.getUSDTTransferByTxid(transfer.txid);
  }

  private async maybeEscalateObservedDepositTimeout(
    order: Order,
    actor: ActorContext,
    actions: string[],
  ): Promise<Order | null> {
    if (
      order.status !== 'WAITING_DEPOSIT' ||
      order.depositObservedAt === null ||
      (order.depositObservedConfirmations ?? 0) >= this.config.orders.minConfirmationsUsdtTrc20
    ) {
      return null;
    }

    const observedAt = order.depositObservedAt as Date;
    const maxObservedWaitMs =
      this.config.orders.depositObservedMaxWaitMinutes * 60_000;
    if (Date.now() - observedAt.getTime() < maxObservedWaitMs) {
      return null;
    }

    const manualReviewOrder = await this.ordersService.markManualReview(
      order.orderId,
      actor,
      'El deposito SELL fue observado pero no alcanzo confirmaciones suficientes dentro de la ventana maxima permitida.',
      {
        source: 'trongrid-poll',
        txid: order.depositObservedTxid,
        amount: order.depositObservedAmount,
        confirmations: order.depositObservedConfirmations,
        observedAt: observedAt.toISOString(),
        maxWaitMinutes: this.config.orders.depositObservedMaxWaitMinutes,
      },
    );
    actions.push('observed-deposit-timeout-manual-review');
    return manualReviewOrder;
  }

  private selectSellDepositTransfer(
    order: Order,
    transfers: TronUsdtTransfer[],
  ): TronUsdtTransfer | null {
    const inboundTransfers = transfers.filter(
      (transfer) => transfer.to === order.depositAddress && transfer.amount > 0,
    );

    if (inboundTransfers.length === 0) {
      return null;
    }

    if (order.depositObservedTxid) {
      return inboundTransfers.find((transfer) => transfer.txid === order.depositObservedTxid) ?? null;
    }

    const sortedTransfers = [...inboundTransfers].sort(
      (left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0),
    );

    if (order.cryptoAmountExpected === null) {
      return (
        sortedTransfers.find(
          (transfer) => transfer.amount >= this.config.orders.minOperationalUsdt,
        ) ?? sortedTransfers[0] ?? null
      );
    }

    const tolerance = this.config.orders.amountTolerancePercent / 100;
    const minAcceptedAmount = order.cryptoAmountExpected * (1 - tolerance);

    return (
      sortedTransfers.find((transfer) => transfer.amount >= minAcceptedAmount) ??
      sortedTransfers[0] ??
      null
    );
  }

  private appendTronGridDetection(
    order: Order,
    transfer: TronUsdtTransfer,
  ): Record<string, unknown> {
    return {
      ...(order.providerGiveRequestRaw ?? {}),
      trongridDetection: {
        txid: transfer.txid,
        from: transfer.from,
        to: transfer.to,
        amount: transfer.amount,
        timestamp: transfer.timestamp,
      },
    };
  }

  private buildNextReconcileRunAt(referenceDate = new Date()): Date {
    return new Date(referenceDate.getTime() + RECONCILE_INTERVAL_MS);
  }

  private isWaitingSellStatus(status: Order['status']): status is (typeof WAITING_SELL_STATUSES)[number] {
    return WAITING_SELL_STATUSES.includes(status as (typeof WAITING_SELL_STATUSES)[number]);
  }

  private shouldContinuePolling(order: Order): boolean {
    if (order.type === 'SELL') {
      return SELL_POLLING_STATUSES.includes(order.status as (typeof SELL_POLLING_STATUSES)[number]);
    }

    return BUY_POLLING_STATUSES.includes(order.status as (typeof BUY_POLLING_STATUSES)[number]);
  }
}
