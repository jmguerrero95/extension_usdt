import { ulid } from 'ulid';
import type { FastifyBaseLogger } from 'fastify';
import { MongoServerError } from 'mongodb';

import type { AppConfig } from '../../app/config/env';
import type { BootContext } from '../../app/boot-context';
import { AppError } from '../../app/errors/app-error';
import type { Order } from '../../domain/entities/order.entity';
import { TERMINAL_ORDER_STATUSES, type OrderStatus } from '../../domain/enums/order-status';
import type { OrderRepository } from '../../domain/repositories/order.repository';
import { assertValidTransition } from '../../domain/state-machine/order-state-machine';
import { OrderModel } from '../../infrastructure/db/models/order.model';
import { encryptText } from '../../infrastructure/crypto/encryption';
import {
  CryptoCurrencyApiBadResponseError,
  CryptoCurrencyApiTimeoutError,
} from '../../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.errors';
import type { CryptoCurrencyApiService } from '../../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.service';
import type { OutboxService } from '../../infrastructure/queue/outbox.service';
import { EnergyRequestModel } from '../../infrastructure/db/models/energy-request.model';
import { ForwardRequestModel } from '../../infrastructure/db/models/forward-request.model';
import { OutboxJobModel } from '../../infrastructure/db/models/outbox-job.model';
import { SendRequestModel } from '../../infrastructure/db/models/send-request.model';
import { JOB_TYPES } from '../../shared/constants/job-types';
import type { ActorContext } from '../../shared/types/actor';
import { buildTronUsdtQrPayload } from '../../shared/utils/qr';
import { normalizeUsdtAmount } from '../../shared/utils/usdt';
import type { AuditService } from '../audit/audit.service';

export interface CreateSellOrderInput {
  asset: 'USDT';
  network: 'TRON';
  fiatCurrency: 'COP';
  fiatAmount: number;
  cryptoAmountExpected?: number;
  externalRef?: string;
  terminalId?: string;
}

export interface CreateBuyOrderInput {
  asset: 'USDT';
  network: 'TRON';
  fiatCurrency: 'COP';
  fiatAmount: number;
  cryptoAmountToSend: number;
  customerDestinationAddress: string;
  externalRef?: string;
  terminalId?: string;
}

export interface CompleteSellPayoutInput {
  casTransactionId: string;
  terminalId?: string;
}

type EnqueueFinancialOperationAction =
  | 'retry-energy'
  | 'retry-buy-energy'
  | 'retry-forward'
  | 'retry-send';

interface TransitionOptions {
  actor: ActorContext;
  reason: string;
  patch?: Partial<Order>;
  metadata?: Record<string, unknown>;
  errorCode?: Order['lastErrorCode'];
  errorMessage?: string;
}

export interface RecordSellDepositObservationInput {
  txid: string;
  amount: number;
  confirmations: number | null;
  source: 'webhook' | 'trongrid';
  checkedAt?: Date;
}

export interface RecordSellDepositObservationResult {
  order: Order;
  conflict: boolean;
  updated: boolean;
  reason?: 'txid_conflict' | 'amount_mismatch' | 'deposit_reused' | 'state_not_eligible';
}

const SELL_CANCELABLE_STATUSES: OrderStatus[] = ['CREATED', 'ADDRESS_ASSIGNED', 'WAITING_DEPOSIT'];
const INITIAL_RECONCILE_INTERVAL_MS = 10_000;
const NEGATIVE_SELL_PAYOUT_STATUSES: OrderStatus[] = [
  'CANCELED',
  'EXPIRED',
  'LATE_DEPOSIT',
  'ERROR_MANUAL_REVIEW',
];
const BUY_CANCELABLE_STATUSES: OrderStatus[] = [
  'CREATED',
  'VALIDATED',
  'ENERGY_ESTIMATION_REQUESTED',
  'ENERGY_ESTIMATED',
  'ENERGY_REQUESTED',
  'ENERGY_CONFIRMED',
  'ERROR_RETRYABLE',
];

const optionsActorId = (actor: ActorContext): string => `${actor.actorType}:${actor.actorId}`;

export class OrdersService {
  public constructor(
    private readonly orderRepository: OrderRepository,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly cryptoCurrencyApiService: CryptoCurrencyApiService,
    private readonly config: AppConfig,
    private readonly logger: FastifyBaseLogger,
    private readonly bootContext?: BootContext,
  ) {}

  public async createSellOrder(input: CreateSellOrderInput, actor: ActorContext) {
    await this.assertNoConflictingOrder(input.externalRef ?? null, input.terminalId ?? null);

    const now = new Date();
    const orderId = `ord_${ulid().toLowerCase()}`;
    const providerUniqId = `sell_${orderId}`;
    const providerLabel = `${input.terminalId ?? ''}|${input.externalRef ?? ''}|${orderId}`;

    const giveParams = this.cryptoCurrencyApiService.buildGiveParams({
      providerUniqId,
      providerLabel,
      waitPeriod: this.config.orders.defaultWaitPeriodMin,
      period: this.config.orders.defaultPeriodMin,
    });

    let giveResult;
    try {
      giveResult = await this.cryptoCurrencyApiService.giveDepositAddress(giveParams);
    } catch (error) {
      if (error instanceof CryptoCurrencyApiTimeoutError) {
        throw new AppError({
          code: 'PROVIDER_TIMEOUT',
          statusCode: 503,
          message:
            'CryptoCurrencyAPI no respondió a tiempo al crear la dirección de depósito.',
        });
      }

      if (error instanceof CryptoCurrencyApiBadResponseError) {
        throw new AppError({
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
          message:
            'CryptoCurrencyAPI respondió con un payload inválido al crear la orden.',
          details: error.details,
        });
      }

      throw error;
    }

    const expiresAt = new Date(now.getTime() + this.config.orders.defaultWaitPeriodMin * 60_000);
    const encryptedPrivateKey =
      this.config.secrets.storeEncryptedPrivateKeys && giveResult.privateKey
        ? encryptText(
            this.config.secrets.privateKeyEncryptionSecret as string,
            giveResult.privateKey,
          )
        : null;

    const order: Order = {
      orderId,
      externalRef: input.externalRef ?? null,
      terminalId: input.terminalId ?? null,
      type: 'SELL',
      asset: 'USDT',
      network: 'TRON',
      fiatCurrency: 'COP',
      fiatAmount: input.fiatAmount,
      cryptoAmountExpected: input.cryptoAmountExpected ?? null,
      cryptoAmountReceived: null,
      cryptoAmountToSend: null,
      depositAddress: giveResult.address,
      depositAddressPublicKey: giveResult.publicKey,
      depositAddressPrivateKeyStored: Boolean(encryptedPrivateKey),
      depositAddressPrivateKeyEncrypted: encryptedPrivateKey,
      customerDestinationAddress: null,
      buySenderAddress: null,
      providerUniqId,
      providerLabel,
      providerGiveRequestRaw: {
        params: giveParams,
        response: giveResult.raw,
      },
      providerForwardRequestId: null,
      providerForwardTxid: null,
      providerSendRequestId: null,
      providerSendTxid: null,
      forwardTargetAddress: this.config.tron.forwardTargetAddress,
      status: 'WAITING_DEPOSIT',
      statusReason: 'Orden creada y dirección de depósito asignada.',
      expiresAt,
      depositObservedAt: null,
      depositObservedAmount: null,
      depositObservedTxid: null,
      depositObservedConfirmations: null,
      depositObservedSource: null,
      depositObservedLastCheckedAt: null,
      depositDetectedAt: null,
      cashPayoutEligibleAt: null,
      cashPayoutConfirmedAt: null,
      cashPayoutCasTransactionId: null,
      cashPayoutTerminalId: null,
      energyEstimatedAt: null,
      energyRequestedAt: null,
      energyConfirmedAt: null,
      forwardRequestedAt: null,
      sweepConfirmedAt: null,
      settlementCompletedAt: null,
      sendRequestedAt: null,
      sendConfirmedAt: null,
      completedAt: null,
      manualReviewRequired: false,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    const createdOrder = await this.orderRepository.create(order);

    await this.auditService.recordTransition({
      orderId,
      fromStatus: 'CREATED',
      toStatus: 'ADDRESS_ASSIGNED',
      reason: 'Dirección de depósito creada por CryptoCurrencyAPI.',
      actorType: actor.actorType,
      actorId: actor.actorId,
      metadata: {
        depositAddress: giveResult.address,
        providerUniqId,
      },
      createdAt: now,
    });

    await this.auditService.recordTransition({
      orderId,
      fromStatus: 'ADDRESS_ASSIGNED',
      toStatus: 'WAITING_DEPOSIT',
      reason: 'Orden lista para esperar depósito.',
      actorType: actor.actorType,
      actorId: actor.actorId,
      metadata: {
        expiresAt: expiresAt.toISOString(),
      },
      createdAt: now,
    });

    await this.outboxService.enqueueUnique({
      jobType: JOB_TYPES.EXPIRE_ORDER,
      orderId,
      runAt: new Date(expiresAt.getTime() + this.config.orders.expirationGraceSec * 1_000),
      maxAttempts: 1,
      payload: {
        reason: 'automatic-expiration',
      },
    });

    await this.outboxService.enqueueUnique({
      jobType: JOB_TYPES.RECONCILE_ORDER,
      orderId,
      runAt: this.buildInitialReconcileRunAt(now),
      maxAttempts: 3,
      payload: {
        reason: 'initial-sell-reconciliation',
      },
    });

    return {
      order: createdOrder,
      qrPayload: buildTronUsdtQrPayload(
        createdOrder.depositAddress as string,
        createdOrder.cryptoAmountExpected,
      ),
    };
  }

  public async createBuyOrder(input: CreateBuyOrderInput, _actor: ActorContext) {
    await this.assertNoConflictingOrder(input.externalRef ?? null, input.terminalId ?? null);

    const now = new Date();
    const orderId = `ord_${ulid().toLowerCase()}`;
    const providerUniqId = `buy_${orderId}`;
    const providerLabel = `${input.terminalId ?? ''}|${input.externalRef ?? ''}|${orderId}`;
    const expiresAt = new Date(now.getTime() + this.config.orders.defaultPeriodMin * 60_000);

    const order: Order = {
      orderId,
      externalRef: input.externalRef ?? null,
      terminalId: input.terminalId ?? null,
      type: 'BUY',
      asset: 'USDT',
      network: 'TRON',
      fiatCurrency: 'COP',
      fiatAmount: input.fiatAmount,
      cryptoAmountExpected: null,
      cryptoAmountReceived: null,
      cryptoAmountToSend: input.cryptoAmountToSend,
      depositAddress: null,
      depositAddressPublicKey: null,
      depositAddressPrivateKeyStored: false,
      depositAddressPrivateKeyEncrypted: null,
      customerDestinationAddress: input.customerDestinationAddress,
      buySenderAddress: this.config.tron.buySenderAddress,
      providerUniqId,
      providerLabel,
      providerGiveRequestRaw: null,
      providerForwardRequestId: null,
      providerForwardTxid: null,
      providerSendRequestId: null,
      providerSendTxid: null,
      forwardTargetAddress: null,
      status: 'CREATED',
      statusReason: 'Orden BUY creada y pendiente de validación/energía.',
      expiresAt,
      depositObservedAt: null,
      depositObservedAmount: null,
      depositObservedTxid: null,
      depositObservedConfirmations: null,
      depositObservedSource: null,
      depositObservedLastCheckedAt: null,
      depositDetectedAt: null,
      cashPayoutEligibleAt: null,
      cashPayoutConfirmedAt: null,
      cashPayoutCasTransactionId: null,
      cashPayoutTerminalId: null,
      energyEstimatedAt: null,
      energyRequestedAt: null,
      energyConfirmedAt: null,
      forwardRequestedAt: null,
      sweepConfirmedAt: null,
      settlementCompletedAt: null,
      sendRequestedAt: null,
      sendConfirmedAt: null,
      completedAt: null,
      manualReviewRequired: false,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    const createdOrder = await this.orderRepository.create(order);

    await this.outboxService.enqueueUnique({
      jobType: JOB_TYPES.REQUEST_BUY_ENERGY,
      orderId,
      maxAttempts: this.config.energy.maxRetryCount,
    });

    await this.outboxService.enqueueUnique({
      jobType: JOB_TYPES.RECONCILE_ORDER,
      orderId,
      runAt: this.buildInitialReconcileRunAt(now),
      maxAttempts: 3,
      payload: {
        reason: 'initial-buy-reconciliation',
      },
    });

    return createdOrder;
  }

  public async getOrderOrFail(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findByOrderId(orderId);
    if (!order) {
      throw new AppError({
        code: 'ORDER_NOT_FOUND',
        statusCode: 404,
        message: 'La orden solicitada no existe.',
      });
    }

    return order;
  }

  public async findByCorrelation(params: Parameters<OrderRepository['findByCorrelation']>[0]) {
    return this.orderRepository.findByCorrelation(params);
  }

  public async getCasSellOrder(orderId: string) {
    const order = await this.getOrderOrFail(orderId);
    this.assertOrderType(order, 'SELL');

    return this.buildCasSellOrderResponse(order);
  }

  public async getCasBuyOrder(orderId: string) {
    const order = await this.getOrderOrFail(orderId);
    this.assertOrderType(order, 'BUY');

    return {
      orderId: order.orderId,
      type: order.type,
      status: order.status,
      cryptoAmountToSend: order.cryptoAmountToSend,
      customerDestinationAddress: order.customerDestinationAddress,
      providerRequestId: order.providerSendRequestId,
      sendTxid: order.providerSendTxid,
      manualReviewRequired: order.manualReviewRequired,
      lastErrorCode: order.lastErrorCode,
      lastErrorMessage: order.lastErrorMessage,
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  public async getInternalOrder(orderId: string): Promise<Order> {
    return this.getOrderOrFail(orderId);
  }

  public async enqueueFinancialOperation(
    orderId: string,
    action: EnqueueFinancialOperationAction,
    actor: ActorContext,
  ): Promise<{
    order: Order;
    enqueued: boolean;
    skipped: boolean;
    jobType: (typeof JOB_TYPES)[keyof typeof JOB_TYPES];
  }> {
    const order = await this.getOrderOrFail(orderId);

    if (order.manualReviewRequired || order.status === 'ERROR_MANUAL_REVIEW') {
      throw new AppError({
        code: 'MANUAL_REVIEW_REQUIRED',
        statusCode: 422,
        message: 'La orden no puede encolar una operacion financiera mientras siga en revision manual.',
      });
    }

    if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message: 'La orden terminal no puede encolar una operacion financiera.',
      });
    }

    const validation = await this.validateManualFinancialOperation(order, action);
    if (validation.skipped) {
      return {
        order: validation.order,
        enqueued: false,
        skipped: true,
        jobType: validation.jobType,
      };
    }

    await this.outboxService.enqueueUniqueNow({
      jobType: validation.jobType,
      orderId,
      maxAttempts: this.resolveJobMaxAttempts(validation.jobType),
      recoveryGeneration: order.recoveryGeneration ?? null,
      payload: {
        reason: 'manual-financial-operation',
        requestedBy: optionsActorId(actor),
        requestedAt: new Date().toISOString(),
        action,
        recoveryGeneration: order.recoveryGeneration ?? null,
      },
    });

    return {
      order,
      enqueued: true,
      skipped: false,
      jobType: validation.jobType,
    };
  }

  public async listOrders(filters?: {
    status?: string;
    terminalId?: string;
    externalRef?: string;
    limit?: number;
    skip?: number;
  }): Promise<Order[]> {
    return this.orderRepository.list(filters);
  }

  public async cancelSellOrder(orderId: string, actor: ActorContext): Promise<Order> {
    const order = await this.getOrderOrFail(orderId);
    this.assertOrderType(order, 'SELL');

    if (order.depositObservedAt !== null) {
      this.logger.warn(
        {
          orderId: order.orderId,
          txid: order.depositObservedTxid,
          internalStatus: order.status,
          casProjectedStatus: this.resolveCasSellProjectedStatus(order),
          confirmations: order.depositObservedConfirmations,
          requiredConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
          source: order.depositObservedSource,
        },
        'cas_sell_cancel_blocked_deposit_observed',
      );

      throw new AppError({
        code: 'DEPOSIT_ALREADY_OBSERVED',
        statusCode: 409,
        message:
          'La orden SELL ya no puede cancelarse porque se observaron fondos en la direccion de deposito.',
      });
    }

    if (!SELL_CANCELABLE_STATUSES.includes(order.status)) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message: 'La orden SELL ya no puede cancelarse porque superó la espera de depósito.',
      });
    }

    return this.transitionOrder(order, 'CANCELED', {
      actor,
      reason: 'Cancelación explícita de la orden SELL por endpoint CAS.',
    });
  }

  public async recordSellDepositObservation(
    orderOrId: Order | string,
    input: RecordSellDepositObservationInput,
  ): Promise<RecordSellDepositObservationResult> {
    const currentOrder =
      typeof orderOrId === 'string' ? await this.getOrderOrFail(orderOrId) : orderOrId;
    this.assertOrderType(currentOrder, 'SELL');

    const normalizedAmount = normalizeUsdtAmount(input.amount);
    const checkedAt = input.checkedAt ?? new Date();
    const nextConfirmations =
      input.confirmations === null ? null : Math.max(0, Math.trunc(input.confirmations));

    if (
      currentOrder.depositObservedTxid !== null &&
      currentOrder.depositObservedTxid !== input.txid
    ) {
      this.logger.warn(
        {
          orderId: currentOrder.orderId,
          txid: input.txid,
          internalStatus: currentOrder.status,
          casProjectedStatus: this.resolveCasSellProjectedStatus(currentOrder),
          confirmations: nextConfirmations,
          requiredConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
          source: input.source,
        },
        'cas_sell_deposit_conflict',
      );

      return {
        order: currentOrder,
        conflict: true,
        updated: false,
        reason: 'txid_conflict',
      };
    }

    if (
      currentOrder.depositObservedTxid === input.txid &&
      currentOrder.depositObservedAmount !== null &&
      currentOrder.depositObservedAmount !== normalizedAmount
    ) {
      this.logger.warn(
        {
          orderId: currentOrder.orderId,
          txid: input.txid,
          internalStatus: currentOrder.status,
          casProjectedStatus: this.resolveCasSellProjectedStatus(currentOrder),
          confirmations: nextConfirmations,
          requiredConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
          source: input.source,
        },
        'cas_sell_deposit_conflict',
      );

      return {
        order: currentOrder,
        conflict: true,
        updated: false,
        reason: 'amount_mismatch',
      };
    }

    const shouldIncreaseConfirmations =
      nextConfirmations !== null &&
      nextConfirmations >
        (currentOrder.depositObservedConfirmations ?? Number.NEGATIVE_INFINITY);
    const isFirstObservation = currentOrder.depositObservedTxid === null;
    if (!isFirstObservation && !shouldIncreaseConfirmations) {
      return {
        order: currentOrder,
        conflict: false,
        updated: false,
      };
    }

    let updatedDocument;
    try {
      updatedDocument = await OrderModel.findOneAndUpdate(
        {
          orderId: currentOrder.orderId,
          type: 'SELL',
          $or: [
            { depositObservedTxid: null },
            { depositObservedTxid: { $exists: false } },
            { depositObservedTxid: input.txid },
          ],
          $and: [
            {
              $or: [
                { depositObservedAmount: null },
                { depositObservedAmount: { $exists: false } },
                { depositObservedAmount: normalizedAmount },
              ],
            },
          ],
        },
        [
          {
            $set: {
              depositObservedAt: { $ifNull: ['$depositObservedAt', checkedAt] },
              depositObservedAmount: { $ifNull: ['$depositObservedAmount', normalizedAmount] },
              depositObservedTxid: { $ifNull: ['$depositObservedTxid', input.txid] },
              depositObservedSource: { $ifNull: ['$depositObservedSource', input.source] },
              depositObservedLastCheckedAt: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$depositObservedAt', null] },
                      nextConfirmations === null
                        ? false
                        : {
                            $or: [
                              { $eq: ['$depositObservedConfirmations', null] },
                              { $lt: ['$depositObservedConfirmations', nextConfirmations] },
                            ],
                          },
                    ],
                  },
                  checkedAt,
                  '$depositObservedLastCheckedAt',
                ],
              },
              depositObservedConfirmations:
                nextConfirmations === null
                  ? '$depositObservedConfirmations'
                  : {
                      $cond: [
                        {
                          $or: [
                            { $eq: ['$depositObservedConfirmations', null] },
                            { $lt: ['$depositObservedConfirmations', nextConfirmations] },
                          ],
                        },
                        nextConfirmations,
                        '$depositObservedConfirmations',
                      ],
                    },
              updatedAt: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$depositObservedAt', null] },
                      nextConfirmations === null
                        ? false
                        : {
                            $or: [
                              { $eq: ['$depositObservedConfirmations', null] },
                              { $lt: ['$depositObservedConfirmations', nextConfirmations] },
                            ],
                          },
                    ],
                  },
                  checkedAt,
                  '$updatedAt',
                ],
              },
            },
          },
        ],
        {
          returnDocument: 'after',
          updatePipeline: true,
        },
      ).exec();
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const reusedOrder = await OrderModel.findOne({
          depositObservedTxid: input.txid,
        })
          .lean<Order>()
          .exec();
        this.logger.warn(
          {
            orderId: currentOrder.orderId,
            txid: input.txid,
            internalStatus: currentOrder.status,
            casProjectedStatus: this.resolveCasSellProjectedStatus(currentOrder),
            confirmations: nextConfirmations,
            requiredConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
            source: input.source,
            conflictingOrderId: reusedOrder?.orderId ?? null,
          },
          'cas_sell_deposit_reused',
        );

        return {
          order: currentOrder,
          conflict: true,
          updated: false,
          reason: 'deposit_reused',
        };
      }

      throw error;
    }

    if (!updatedDocument) {
      const reloadedOrder = await this.getOrderOrFail(currentOrder.orderId);
      const txidConflict =
        reloadedOrder.depositObservedTxid !== null &&
        reloadedOrder.depositObservedTxid !== input.txid;
      const amountMismatch =
        reloadedOrder.depositObservedTxid === input.txid &&
        reloadedOrder.depositObservedAmount !== null &&
        reloadedOrder.depositObservedAmount !== normalizedAmount;
      const stateNotEligible = currentOrder.status !== reloadedOrder.status;

      return {
        order: reloadedOrder,
        conflict: txidConflict || amountMismatch,
        updated: false,
        reason: txidConflict
          ? 'txid_conflict'
          : amountMismatch
            ? 'amount_mismatch'
            : stateNotEligible
              ? 'state_not_eligible'
              : undefined,
      };
    }

    const updatedOrder = await this.getOrderOrFail(currentOrder.orderId);
    const changed =
      currentOrder.depositObservedAt?.getTime() !== updatedOrder.depositObservedAt?.getTime() ||
      currentOrder.depositObservedAmount !== updatedOrder.depositObservedAmount ||
      currentOrder.depositObservedTxid !== updatedOrder.depositObservedTxid ||
      currentOrder.depositObservedConfirmations !== updatedOrder.depositObservedConfirmations ||
      currentOrder.depositObservedSource !== updatedOrder.depositObservedSource ||
      currentOrder.depositObservedLastCheckedAt?.getTime() !==
        updatedOrder.depositObservedLastCheckedAt?.getTime();

    if (changed) {
      this.logger.info(
        {
          orderId: updatedOrder.orderId,
          txid: updatedOrder.depositObservedTxid,
          internalStatus: updatedOrder.status,
          casProjectedStatus: this.resolveCasSellProjectedStatus(updatedOrder),
          confirmations: updatedOrder.depositObservedConfirmations,
          requiredConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
          source: updatedOrder.depositObservedSource,
        },
        'cas_sell_deposit_observed',
      );
    }

    return {
      order: updatedOrder,
      conflict: false,
      updated: changed,
    };
  }

  public async cancelBuyOrder(orderId: string, actor: ActorContext): Promise<Order> {
    const order = await this.getOrderOrFail(orderId);
    this.assertOrderType(order, 'BUY');

    if (
      !BUY_CANCELABLE_STATUSES.includes(order.status) ||
      order.providerSendRequestId !== null ||
      order.sendRequestedAt !== null ||
      ['SEND_REQUESTED', 'SEND_ACCEPTED', 'SEND_BROADCASTED', 'DELIVERY_CONFIRMED', 'READY_FOR_PAYOUT', 'COMPLETED'].includes(order.status)
    ) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message:
          'La orden BUY ya no puede cancelarse porque el envío fue solicitado o ya avanzó.',
      });
    }

    return this.transitionOrder(order, 'CANCELED', {
      actor,
      reason: 'Cancelación explícita de la orden BUY por endpoint CAS.',
    });
  }

  public async completeSellPayout(
    orderId: string,
    input: CompleteSellPayoutInput,
    actor: ActorContext,
  ): Promise<Order> {
    const order = await this.getOrderOrFail(orderId);
    this.assertOrderType(order, 'SELL');
    this.assertCasSellCorrelation(order, input);

    if (order.status === 'COMPLETED') {
      return order;
    }

    if (order.cashPayoutConfirmedAt !== null) {
      if (order.settlementCompletedAt !== null) {
        return this.transitionOrder(order, 'COMPLETED', {
          actor,
          reason: 'Payout SELL ya confirmado por CAS y el settlement interno termino.',
          metadata: {
            casTransactionId: order.cashPayoutCasTransactionId ?? input.casTransactionId,
            terminalId: order.cashPayoutTerminalId ?? input.terminalId ?? order.terminalId,
            source: 'cas-payout-complete-idempotent',
          },
        });
      }

      return order;
    }

    if (!this.isSellCashPayoutEligible(order)) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message:
          'La orden SELL no puede registrar el payout porque todavia no es elegible para entregar efectivo.',
        details: {
          orderId: order.orderId,
          status: order.status,
        },
      });
    }

    const cashPayoutConfirmedAt = new Date();
    const cashPayoutTerminalId = input.terminalId ?? order.terminalId ?? null;
    const payoutPatch: Partial<Order> = {
      cashPayoutConfirmedAt,
      cashPayoutCasTransactionId: input.casTransactionId,
      cashPayoutTerminalId,
    };

    let updatedOrder: Order;
    if (order.settlementCompletedAt !== null) {
      updatedOrder = await this.transitionOrder(order, 'COMPLETED', {
        actor,
        reason: 'Payout SELL confirmado por CAS despues de la entrega de efectivo.',
        patch: payoutPatch,
        metadata: {
          casTransactionId: input.casTransactionId,
          terminalId: cashPayoutTerminalId,
          source: 'cas-payout-complete',
        },
      });
    } else {
      updatedOrder = await this.patchOrder(orderId, payoutPatch);
    }

    this.logger.info(
      {
        orderId: updatedOrder.orderId,
        internalStatus: updatedOrder.status,
        casTransactionId: input.casTransactionId,
        terminalId: cashPayoutTerminalId,
        settlementCompletedAt: updatedOrder.settlementCompletedAt?.toISOString() ?? null,
      },
      'cas_sell_cash_payout_confirmed',
    );

    return updatedOrder;
  }

  public async markManualReview(
    orderId: string,
    actor: ActorContext,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<Order> {
    const order = await this.getOrderOrFail(orderId);
    if (order.status === 'ERROR_MANUAL_REVIEW') {
      return order;
    }

    const updatedOrder = await this.transitionOrder(order, 'ERROR_MANUAL_REVIEW', {
      actor,
      reason,
      metadata,
      patch: {
        manualReviewRequired: true,
      },
      errorCode: 'MANUAL_REVIEW_REQUIRED',
      errorMessage: reason,
    });

    await this.outboxService.cancelActiveJobsForOrder(
      orderId,
      'ORDER_REQUIRES_MANUAL_REVIEW',
      optionsActorId(actor),
    );

    return updatedOrder;
  }

  public async markStartupManualReview(
    order: Order,
    actor: ActorContext,
    bootId: string,
    interruptedAt: Date,
    interruptedJobIds: string[] = [],
  ): Promise<Order> {
    if (order.status === 'ERROR_MANUAL_REVIEW') {
      return order;
    }

    return this.transitionOrder(order, 'ERROR_MANUAL_REVIEW', {
      actor,
      reason: 'La orden existia antes del arranque actual y requiere revision manual antes de continuar.',
      patch: {
        manualReviewRequired: true,
        manualReviewCode: 'SERVER_RESTART_REQUIRES_REVIEW',
        interruptedAt,
        interruptedByBootId: bootId,
        statusBeforeManualReview: order.status,
        startupQuarantineGeneration: bootId,
      },
      metadata: {
        manualReviewCode: 'SERVER_RESTART_REQUIRES_REVIEW',
        previousStatus: order.status,
        interruptedJobIds,
        interruptedAt: interruptedAt.toISOString(),
        bootId,
      },
      errorCode: 'MANUAL_REVIEW_REQUIRED',
      errorMessage:
        'La orden existia antes del arranque actual y requiere revision manual antes de continuar.',
    });
  }

  public async resumeManualReview(
    orderId: string,
    actor: ActorContext,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<Order> {
    const order = await this.getOrderOrFail(orderId);
    if (TERMINAL_ORDER_STATUSES.includes(order.status) && order.status !== 'ERROR_MANUAL_REVIEW') {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message: 'La orden terminal no puede reanudarse.',
      });
    }

    if (order.status !== 'ERROR_MANUAL_REVIEW' || !order.manualReviewRequired) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message: 'La orden no esta en revision manual.',
      });
    }

    if (await this.hasUnresolvedOutcomeUnknown(orderId)) {
      throw new AppError({
        code: 'MANUAL_REVIEW_REQUIRED',
        statusCode: 409,
        message:
          'La orden no puede reanudarse mientras exista una solicitud externa con resultado incierto.',
      });
    }

    const resumedAt = new Date();
    const resumedBy = optionsActorId(actor);
    const nextGeneration = (order.recoveryGeneration ?? 0) + 1;

    const resumedOrder = await this.transitionOrder(order, 'ERROR_RETRYABLE', {
      actor,
      reason,
      patch: {
        manualReviewRequired: false,
        recoveryGeneration: nextGeneration,
        resumedAt,
        resumedBy,
        authorizedBootId: this.bootContext?.bootId ?? null,
        authorizedRecoveryGeneration: nextGeneration,
        authorizedAt: resumedAt,
        authorizedBy: resumedBy,
      },
      metadata: {
        ...(metadata ?? {}),
        recoveryGeneration: nextGeneration,
        resumedAt: resumedAt.toISOString(),
        resumedBy,
        authorizedBootId: this.bootContext?.bootId ?? null,
        authorizedRecoveryGeneration: nextGeneration,
      },
    });

    await this.outboxService.enqueue({
      jobType: this.resolveRecoveryJobType(resumedOrder),
      orderId,
      maxAttempts: this.resolveRecoveryMaxAttempts(resumedOrder),
      payload: {
        reason: 'manual-resume',
        recoveryGeneration: nextGeneration,
        resumedBy,
        resumedAt: resumedAt.toISOString(),
      },
    });

    return resumedOrder;
  }

  public async completeManualReviewOrder(
    orderId: string,
    actor: ActorContext,
    reason: string,
    reference?: string | null,
  ): Promise<Order> {
    const order = await this.getOrderOrFail(orderId);
    if (order.status !== 'ERROR_MANUAL_REVIEW') {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message: 'Solo una orden en revision manual puede completarse manualmente por esta accion.',
      });
    }

    const resolvedAt = new Date();
    const resolvedBy = optionsActorId(actor);
    const updated = await this.transitionOrder(order, 'COMPLETED', {
      actor,
      reason,
      patch: {
        resolvedManually: true,
        manualResolutionType: 'COMPLETED',
        manualResolutionReason: reason,
        manualResolutionReference: reference ?? null,
        resolvedBy,
        resolvedAt,
        manualReviewRequired: false,
      },
      metadata: {
        manualResolutionType: 'COMPLETED',
        reference: reference ?? null,
        resolvedBy,
        resolvedAt: resolvedAt.toISOString(),
      },
    });

    return updated;
  }

  public async cancelManualReviewOrder(
    orderId: string,
    actor: ActorContext,
    reason: string,
    reference?: string | null,
  ): Promise<Order> {
    const order = await this.getOrderOrFail(orderId);
    if (order.status !== 'ERROR_MANUAL_REVIEW') {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message: 'Solo una orden en revision manual puede cancelarse definitivamente por esta accion.',
      });
    }

    const resolvedAt = new Date();
    const resolvedBy = optionsActorId(actor);
    return this.transitionOrder(order, 'CANCELED', {
      actor,
      reason,
      patch: {
        resolvedManually: true,
        manualResolutionType: 'CANCELED',
        manualResolutionReason: reason,
        manualResolutionReference: reference ?? null,
        resolvedBy,
        resolvedAt,
        manualReviewRequired: false,
      },
      metadata: {
        manualResolutionType: 'CANCELED',
        reference: reference ?? null,
        resolvedBy,
        resolvedAt: resolvedAt.toISOString(),
      },
    });
  }

  public async assertExternalEffectsAllowed(
    orderId: string,
    allowedStatuses: OrderStatus[],
  ): Promise<Order> {
    const order = await this.getOrderOrFail(orderId);
    if (order.manualReviewRequired || order.status === 'ERROR_MANUAL_REVIEW') {
      throw new AppError({
        code: 'MANUAL_REVIEW_REQUIRED',
        statusCode: 422,
        message: 'La orden no puede ejecutar efectos externos porque esta en revision manual.',
      });
    }

    if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message: 'La orden terminal no puede ejecutar efectos externos.',
      });
    }

    if (!allowedStatuses.includes(order.status)) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message: 'La orden cambio de estado antes de ejecutar el efecto externo.',
        details: {
          orderId,
          status: order.status,
          allowedStatuses,
        },
      });
    }

    return order;
  }

  public async resolveOutcomeUnknown(
    orderId: string,
    actor: ActorContext,
    resolution: 'retry' | 'complete' | 'cancel',
    reason: string,
    reference?: string | null,
  ): Promise<Order> {
    const order = await this.getOrderOrFail(orderId);
    if (order.status !== 'ERROR_MANUAL_REVIEW' || !order.manualReviewRequired) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message: 'Solo una orden en revision manual puede resolver OUTCOME_UNKNOWN.',
      });
    }

    const resolvedAt = new Date();
    const resolvedBy = optionsActorId(actor);
    await Promise.all([
      EnergyRequestModel.updateMany(
        { orderId, status: 'OUTCOME_UNKNOWN' },
        {
          $set: {
            status: 'OUTCOME_RESOLVED',
            outcomeResolution:
              resolution === 'retry' ? 'CONFIRMED_NOT_EXECUTED' : 'RESOLVED_MANUALLY',
            outcomeResolvedAt: resolvedAt,
            outcomeResolvedBy: resolvedBy,
            outcomeResolutionReason: reason,
            outcomeResolutionReference: reference ?? null,
            updatedAt: resolvedAt,
          },
        },
      ).exec(),
      ForwardRequestModel.updateMany(
        { orderId, status: 'OUTCOME_UNKNOWN' },
        {
          $set: {
            status: 'OUTCOME_RESOLVED',
            outcomeResolution:
              resolution === 'retry' ? 'CONFIRMED_NOT_EXECUTED' : 'RESOLVED_MANUALLY',
            outcomeResolvedAt: resolvedAt,
            outcomeResolvedBy: resolvedBy,
            outcomeResolutionReason: reason,
            outcomeResolutionReference: reference ?? null,
            updatedAt: resolvedAt,
          },
        },
      ).exec(),
      SendRequestModel.updateMany(
        { orderId, status: 'OUTCOME_UNKNOWN' },
        {
          $set: {
            status: 'OUTCOME_RESOLVED',
            outcomeResolution:
              resolution === 'retry' ? 'CONFIRMED_NOT_EXECUTED' : 'RESOLVED_MANUALLY',
            outcomeResolvedAt: resolvedAt,
            outcomeResolvedBy: resolvedBy,
            outcomeResolutionReason: reason,
            outcomeResolutionReference: reference ?? null,
            updatedAt: resolvedAt,
          },
        },
      ).exec(),
    ]);

    if (resolution === 'complete') {
      return this.completeManualReviewOrder(orderId, actor, reason, reference);
    }

    if (resolution === 'cancel') {
      return this.cancelManualReviewOrder(orderId, actor, reason, reference);
    }

    const retryOrder = await this.transitionOrder(order, 'ERROR_RETRYABLE', {
      actor,
      reason,
      patch: {
        manualReviewRequired: false,
        resolvedManually: false,
        outcomeResolution: 'CONFIRMED_NOT_EXECUTED',
        outcomeResolvedAt: resolvedAt,
        outcomeResolvedBy: resolvedBy,
        recoveryGeneration: (order.recoveryGeneration ?? 0) + 1,
        resumedAt: resolvedAt,
        resumedBy: resolvedBy,
        authorizedBootId: this.bootContext?.bootId ?? null,
        authorizedRecoveryGeneration: (order.recoveryGeneration ?? 0) + 1,
        authorizedAt: resolvedAt,
        authorizedBy: resolvedBy,
        resolvedBy,
        resolvedAt,
      },
      metadata: {
        source: 'outcome-unknown-resolution',
        outcomeResolution: 'CONFIRMED_NOT_EXECUTED',
        reference: reference ?? null,
        resolvedBy,
        resolvedAt: resolvedAt.toISOString(),
        authorizedBootId: this.bootContext?.bootId ?? null,
      },
    });

    await this.outboxService.enqueue({
      jobType: this.resolveRecoveryJobType(retryOrder),
      orderId,
      maxAttempts: this.resolveRecoveryMaxAttempts(retryOrder),
      payload: {
        reason: 'manual-outcome-unknown-retry',
        recoveryGeneration: retryOrder.recoveryGeneration ?? 0,
        resolvedBy,
        resolvedAt: resolvedAt.toISOString(),
      },
    });

    return retryOrder;
  }

  public async transitionOrder(
    orderOrId: Order | string,
    nextStatus: OrderStatus,
    options: TransitionOptions,
  ): Promise<Order> {
    const currentOrder =
      typeof orderOrId === 'string' ? await this.getOrderOrFail(orderOrId) : orderOrId;

    if (currentOrder.status === nextStatus) {
      return currentOrder;
    }

    assertValidTransition(currentOrder.type, currentOrder.status, nextStatus);
    const now = new Date();

    const patch: Partial<Order> = {
      ...(options.patch ?? {}),
      statusReason: options.reason,
      lastErrorCode: options.errorCode ?? null,
      lastErrorMessage: options.errorMessage ?? null,
      manualReviewRequired:
        nextStatus === 'ERROR_MANUAL_REVIEW' || nextStatus === 'LATE_DEPOSIT'
          ? true
          : (options.patch?.manualReviewRequired ?? currentOrder.manualReviewRequired),
    };

    switch (nextStatus) {
      case 'DEPOSIT_DETECTED':
        patch.depositDetectedAt = options.patch?.depositDetectedAt ?? now;
        if (
          currentOrder.type === 'SELL' &&
          currentOrder.cashPayoutEligibleAt === null &&
          patch.cashPayoutEligibleAt === undefined
        ) {
          patch.cashPayoutEligibleAt = now;
        }
        break;
      case 'ENERGY_ESTIMATED':
        patch.energyEstimatedAt = options.patch?.energyEstimatedAt ?? now;
        break;
      case 'ENERGY_REQUESTED':
        patch.energyRequestedAt = options.patch?.energyRequestedAt ?? now;
        break;
      case 'ENERGY_CONFIRMED':
        patch.energyConfirmedAt = options.patch?.energyConfirmedAt ?? now;
        break;
      case 'FORWARD_REQUESTED':
        patch.forwardRequestedAt = options.patch?.forwardRequestedAt ?? now;
        break;
      case 'SWEEP_CONFIRMED':
        patch.sweepConfirmedAt = options.patch?.sweepConfirmedAt ?? now;
        if (
          currentOrder.type === 'SELL' &&
          currentOrder.settlementCompletedAt === null &&
          patch.settlementCompletedAt === undefined
        ) {
          patch.settlementCompletedAt = now;
        }
        break;
      case 'SEND_REQUESTED':
        patch.sendRequestedAt = options.patch?.sendRequestedAt ?? now;
        break;
      case 'DELIVERY_CONFIRMED':
        patch.sendConfirmedAt = options.patch?.sendConfirmedAt ?? now;
        break;
      case 'COMPLETED':
        patch.completedAt = options.patch?.completedAt ?? now;
        if (currentOrder.type === 'BUY' && !patch.sendConfirmedAt) {
          patch.sendConfirmedAt = currentOrder.sendConfirmedAt ?? now;
        }
        break;
      default:
        break;
    }

    const updatedOrder = await this.orderRepository.updateStatus(
      currentOrder.orderId,
      currentOrder.status,
      nextStatus,
      patch,
    );

    if (!updatedOrder) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message: 'No fue posible aplicar la transición solicitada sobre la orden.',
        details: {
          orderId: currentOrder.orderId,
          fromStatus: currentOrder.status,
          toStatus: nextStatus,
        },
      });
    }

    await this.auditService.recordTransition({
      orderId: currentOrder.orderId,
      fromStatus: currentOrder.status,
      toStatus: nextStatus,
      reason: options.reason,
      actorType: options.actor.actorType,
      actorId: options.actor.actorId,
      metadata: options.metadata ?? null,
      createdAt: now,
    });

    if (['COMPLETED', 'CANCELED', 'EXPIRED', 'LATE_DEPOSIT'].includes(nextStatus)) {
      await this.outboxService.cancelActiveJobsForOrder(
        currentOrder.orderId,
        `ORDER_${nextStatus}`,
        optionsActorId(options.actor),
      );
    }

    if (updatedOrder.type === 'SELL' && nextStatus === 'DEPOSIT_DETECTED') {
      this.logger.info(
        {
          orderId: updatedOrder.orderId,
          txid: updatedOrder.depositObservedTxid,
          internalStatus: updatedOrder.status,
          casProjectedStatus: this.resolveCasSellProjectedStatus(updatedOrder),
          confirmations:
            updatedOrder.depositObservedConfirmations ?? options.metadata?.['confirmations'] ?? null,
          requiredConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
          source: updatedOrder.depositObservedSource ?? options.metadata?.['source'] ?? null,
        },
        'cas_sell_deposit_confirmed',
      );

      if (updatedOrder.cashPayoutEligibleAt !== null) {
        this.logger.info(
          {
            orderId: updatedOrder.orderId,
            internalStatus: updatedOrder.status,
            cashPayoutEligibleAt: updatedOrder.cashPayoutEligibleAt?.toISOString() ?? null,
            txid: updatedOrder.depositObservedTxid,
            confirmations: updatedOrder.depositObservedConfirmations,
            cryptoAmountReceived: updatedOrder.cryptoAmountReceived,
          },
          'cas_sell_cash_payout_eligible',
        );
      }
    }

    if (updatedOrder.type === 'SELL' && nextStatus === 'READY_FOR_PAYOUT') {
      this.logger.info(
        {
          orderId: updatedOrder.orderId,
          txid: updatedOrder.depositObservedTxid,
          internalStatus: updatedOrder.status,
          casProjectedStatus: updatedOrder.status,
          confirmations: updatedOrder.depositObservedConfirmations,
          requiredConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
          source: updatedOrder.depositObservedSource,
        },
        'cas_sell_ready_for_payout',
      );
    }

    if (updatedOrder.type === 'SELL' && nextStatus === 'SWEEP_CONFIRMED') {
      this.logger.info(
        {
          orderId: updatedOrder.orderId,
          internalStatus: updatedOrder.status,
          settlementCompletedAt: updatedOrder.settlementCompletedAt?.toISOString() ?? null,
          txid: updatedOrder.providerForwardTxid,
        },
        'sell_settlement_completed',
      );
    }

    if (
      updatedOrder.type === 'SELL' &&
      nextStatus === 'COMPLETED' &&
      updatedOrder.cashPayoutConfirmedAt !== null &&
      updatedOrder.settlementCompletedAt !== null
    ) {
      this.logger.info(
        {
          orderId: updatedOrder.orderId,
          cashPayoutConfirmedAt: updatedOrder.cashPayoutConfirmedAt?.toISOString() ?? null,
          settlementCompletedAt: updatedOrder.settlementCompletedAt?.toISOString() ?? null,
        },
        'sell_completed_after_cash_and_settlement',
      );
    }

    return updatedOrder;
  }

  public async patchOrder(orderId: string, patch: Partial<Order>): Promise<Order> {
    const updatedOrder = await this.orderRepository.update(orderId, patch);

    if (!updatedOrder) {
      throw new AppError({
        code: 'ORDER_NOT_FOUND',
        statusCode: 404,
        message: 'La orden solicitada no existe.',
      });
    }

    return updatedOrder;
  }

  public async expireOrderIfNeeded(orderId: string, actor: ActorContext): Promise<Order> {
    const order = await this.getOrderOrFail(orderId);
    this.assertOrderType(order, 'SELL');

    if (!SELL_CANCELABLE_STATUSES.includes(order.status)) {
      return order;
    }

    if (order.depositObservedAt !== null) {
      return order;
    }

    if (order.expiresAt.getTime() > Date.now()) {
      return order;
    }

    return this.transitionOrder(order, 'EXPIRED', {
      actor,
      reason: 'Expiración automática por scheduler.',
      errorCode: 'ORDER_EXPIRED',
      errorMessage: 'La orden expiró sin depósito válido.',
    });
  }

  private async assertNoConflictingOrder(
    externalRef: string | null,
    terminalId: string | null,
  ): Promise<void> {
    if (!externalRef) {
      return;
    }

    const candidates = await this.orderRepository.list({
      externalRef,
      terminalId: terminalId ?? undefined,
      limit: 20,
      skip: 0,
    });

    const conflict = candidates.find((order) => !TERMINAL_ORDER_STATUSES.includes(order.status));
    if (conflict) {
      throw new AppError({
        code: 'ORDER_ALREADY_EXISTS',
        statusCode: 409,
        message: 'Ya existe una orden activa con la misma referencia externa.',
        details: {
          orderId: conflict.orderId,
          status: conflict.status,
        },
      });
    }
  }

  private assertOrderType(order: Order, expectedType: Order['type']): void {
    if (order.type !== expectedType) {
      throw new AppError({
        code: 'ORDER_NOT_FOUND',
        statusCode: 404,
        message: `La orden solicitada no corresponde a un flujo ${expectedType}.`,
      });
    }
  }

  private assertCasSellCorrelation(order: Order, input: CompleteSellPayoutInput): void {
    if (order.externalRef && order.externalRef !== input.casTransactionId) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message:
          'La confirmacion de payout no corresponde al transaction id de CAS asociado a la orden SELL.',
        details: {
          orderId: order.orderId,
          expectedCasTransactionId: order.externalRef,
          receivedCasTransactionId: input.casTransactionId,
        },
      });
    }

    if (input.terminalId && order.terminalId && order.terminalId !== input.terminalId) {
      throw new AppError({
        code: 'INVALID_STATE_TRANSITION',
        statusCode: 409,
        message:
          'La confirmacion de payout no corresponde al terminal asociado a la orden SELL.',
        details: {
          orderId: order.orderId,
          expectedTerminalId: order.terminalId,
          receivedTerminalId: input.terminalId,
        },
      });
    }
  }

  private buildInitialReconcileRunAt(referenceDate: Date): Date {
    return new Date(referenceDate.getTime() + INITIAL_RECONCILE_INTERVAL_MS);
  }

  private resolveCasSellProjectedStatus(order: Order): OrderStatus {
    if (this.shouldProjectSellReadyForPayout(order)) {
      return 'READY_FOR_PAYOUT';
    }

    if (
      order.type === 'SELL' &&
      order.status === 'WAITING_DEPOSIT' &&
      order.depositObservedAt !== null &&
      order.depositObservedAmount !== null
    ) {
      return 'DEPOSIT_DETECTED';
    }

    return order.status;
  }

  private buildCasSellOrderResponse(order: Order) {
    const projectedStatus = this.resolveCasSellProjectedStatus(order);
    if (projectedStatus === 'READY_FOR_PAYOUT' && order.status !== 'READY_FOR_PAYOUT') {
      this.logger.info(
        {
          orderId: order.orderId,
          internalStatus: order.status,
          projectedStatus,
          cashPayoutEligibleAt: order.cashPayoutEligibleAt?.toISOString() ?? null,
          settlementCompletedAt: order.settlementCompletedAt?.toISOString() ?? null,
          cashPayoutConfirmedAt: order.cashPayoutConfirmedAt?.toISOString() ?? null,
        },
        'cas_sell_projected_ready_for_payout',
      );
    }

    const cryptoAmountReceived =
      projectedStatus === 'DEPOSIT_DETECTED' && order.status === 'WAITING_DEPOSIT'
        ? order.depositObservedAmount
        : order.cryptoAmountReceived;

    return {
      orderId: order.orderId,
      status: projectedStatus,
      cryptoAmountExpected: order.cryptoAmountExpected,
      cryptoAmountReceived,
      depositAddress: order.depositAddress,
      forwardTxid: order.providerForwardTxid,
      manualReviewRequired: order.manualReviewRequired,
      lastErrorCode: order.lastErrorCode,
      lastErrorMessage: order.lastErrorMessage,
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private isSellCashPayoutEligible(order: Order): boolean {
    return (
      order.type === 'SELL' &&
      order.cashPayoutEligibleAt !== null &&
      order.cryptoAmountReceived !== null &&
      !order.manualReviewRequired &&
      !NEGATIVE_SELL_PAYOUT_STATUSES.includes(order.status)
    );
  }

  private shouldProjectSellReadyForPayout(order: Order): boolean {
    return this.isSellCashPayoutEligible(order) && order.status !== 'COMPLETED';
  }

  private resolveRecoveryJobType(order: Order): (typeof JOB_TYPES)[keyof typeof JOB_TYPES] {
    if (order.type === 'BUY') {
      return order.energyConfirmedAt ? JOB_TYPES.SEND_BUY : JOB_TYPES.REQUEST_BUY_ENERGY;
    }

    return order.energyConfirmedAt ? JOB_TYPES.REQUEST_FORWARD : JOB_TYPES.REQUEST_ENERGY;
  }

  private resolveRecoveryMaxAttempts(order: Order): number {
    if (order.type === 'BUY') {
      return order.energyConfirmedAt ? this.config.buy.maxRetryCount : this.config.energy.maxRetryCount;
    }

    return order.energyConfirmedAt
      ? this.config.forward.maxRetryCount
      : this.config.energy.maxRetryCount;
  }

  private resolveManualFinancialJobType(
    order: Order,
    action: EnqueueFinancialOperationAction,
  ): (typeof JOB_TYPES)[keyof typeof JOB_TYPES] {
    switch (action) {
      case 'retry-energy':
        this.assertOrderType(order, 'SELL');
        return JOB_TYPES.REQUEST_ENERGY;
      case 'retry-buy-energy':
        this.assertOrderType(order, 'BUY');
        return JOB_TYPES.REQUEST_BUY_ENERGY;
      case 'retry-forward':
        this.assertOrderType(order, 'SELL');
        return JOB_TYPES.REQUEST_FORWARD;
      case 'retry-send':
        this.assertOrderType(order, 'BUY');
        return JOB_TYPES.SEND_BUY;
    }
  }

  private async validateManualFinancialOperation(
    order: Order,
    action: EnqueueFinancialOperationAction,
  ): Promise<{
    order: Order;
    skipped: boolean;
    jobType: (typeof JOB_TYPES)[keyof typeof JOB_TYPES];
  }> {
    const jobType = this.resolveManualFinancialJobType(order, action);
    const existingPendingJob = await OutboxJobModel.exists({
      orderId: order.orderId,
      jobType,
      status: { $in: ['PENDING', 'RUNNING'] },
    }).exec();
    if (existingPendingJob) {
      return { order, skipped: true, jobType };
    }

    switch (action) {
      case 'retry-energy': {
        if (order.cryptoAmountReceived === null) {
          throw new AppError({
            code: 'MANUAL_REVIEW_REQUIRED',
            statusCode: 422,
            message: 'La orden SELL no tiene un monto depositado confirmado para solicitar energia.',
          });
        }

        const activeRequest = await EnergyRequestModel.exists({
          orderId: order.orderId,
          status: { $in: ['PENDING', 'REQUESTED', 'CONFIRMED', 'OUTCOME_UNKNOWN'] },
        }).exec();
        if (activeRequest || order.status === 'ENERGY_CONFIRMED') {
          return { order, skipped: true, jobType };
        }

        if (
          !['DEPOSIT_DETECTED', 'ENERGY_ESTIMATION_REQUESTED', 'ENERGY_ESTIMATED', 'ERROR_RETRYABLE'].includes(
            order.status,
          )
        ) {
          throw new AppError({
            code: 'INVALID_STATE_TRANSITION',
            statusCode: 409,
            message: 'La orden no esta lista para solicitar energia.',
          });
        }

        return { order, skipped: false, jobType };
      }
      case 'retry-buy-energy': {
        if (
          order.cryptoAmountToSend === null ||
          order.cryptoAmountToSend < this.config.orders.minOperationalUsdtBuy
        ) {
          await this.markManualReview(
            order.orderId,
            {
              actorType: 'system',
              actorId: 'enqueue-financial-operation',
            },
            'La orden BUY no cumple el minimo operativo requerido para solicitar energia.',
            {
              cryptoAmountToSend: order.cryptoAmountToSend,
              minOperationalUsdtBuy: this.config.orders.minOperationalUsdtBuy,
              source: 'manual-financial-operation',
            },
          );
          throw new AppError({
            code: 'MANUAL_REVIEW_REQUIRED',
            statusCode: 422,
            message: 'La orden BUY no cumple el minimo operativo requerido para solicitar energia.',
          });
        }

        const activeRequest = await EnergyRequestModel.exists({
          orderId: order.orderId,
          status: { $in: ['PENDING', 'REQUESTED', 'CONFIRMED', 'OUTCOME_UNKNOWN'] },
        }).exec();
        if (activeRequest || order.status === 'ENERGY_CONFIRMED') {
          return { order, skipped: true, jobType };
        }

        if (
          !['CREATED', 'VALIDATED', 'ENERGY_ESTIMATION_REQUESTED', 'ENERGY_ESTIMATED', 'ERROR_RETRYABLE'].includes(
            order.status,
          )
        ) {
          throw new AppError({
            code: 'INVALID_STATE_TRANSITION',
            statusCode: 409,
            message: 'La orden no esta lista para solicitar energia.',
          });
        }

        return { order, skipped: false, jobType };
      }
      case 'retry-forward': {
        if (!order.energyConfirmedAt) {
          throw new AppError({
            code: 'ENERGY_NOT_CONFIRMED',
            statusCode: 409,
            message: 'La orden no tiene energia confirmada para ejecutar el forward.',
          });
        }

        const activeRequest = await ForwardRequestModel.exists({
          orderId: order.orderId,
          status: { $in: ['REQUESTED', 'ACCEPTED', 'CONFIRMED', 'OUTCOME_UNKNOWN'] },
        }).exec();
        if (
          activeRequest ||
          ['FORWARD_ACCEPTED', 'SWEEP_CONFIRMED', 'READY_FOR_PAYOUT', 'COMPLETED'].includes(
            order.status,
          )
        ) {
          return { order, skipped: true, jobType };
        }

        if (!['ENERGY_CONFIRMED', 'FORWARD_REQUESTED', 'ERROR_RETRYABLE'].includes(order.status)) {
          throw new AppError({
            code: 'ENERGY_NOT_CONFIRMED',
            statusCode: 409,
            message: 'La orden no tiene energia confirmada para ejecutar el forward.',
          });
        }

        return { order, skipped: false, jobType };
      }
      case 'retry-send': {
        const activeRequest = await SendRequestModel.exists({
          orderId: order.orderId,
          status: { $in: ['REQUESTED', 'ACCEPTED', 'BROADCASTED', 'CONFIRMED', 'OUTCOME_UNKNOWN'] },
        }).exec();
        if (
          activeRequest ||
          ['SEND_ACCEPTED', 'SEND_BROADCASTED', 'DELIVERY_CONFIRMED', 'READY_FOR_PAYOUT', 'COMPLETED'].includes(
            order.status,
          )
        ) {
          return { order, skipped: true, jobType };
        }

        if (
          order.cryptoAmountToSend === null ||
          order.cryptoAmountToSend < this.config.orders.minOperationalUsdtBuy
        ) {
          throw new AppError({
            code: 'MANUAL_REVIEW_REQUIRED',
            statusCode: 422,
            message: 'La orden BUY no cumple el minimo operativo requerido para ejecutar el envio.',
          });
        }

        if (!order.energyConfirmedAt) {
          throw new AppError({
            code: 'ENERGY_NOT_CONFIRMED',
            statusCode: 409,
            message: 'La orden BUY no tiene energia confirmada para ejecutar el envio.',
          });
        }

        if (!['ENERGY_CONFIRMED', 'SEND_REQUESTED', 'ERROR_RETRYABLE'].includes(order.status)) {
          throw new AppError({
            code: 'ENERGY_NOT_CONFIRMED',
            statusCode: 409,
            message: 'La orden BUY no tiene energia confirmada para ejecutar el envio.',
          });
        }

        return { order, skipped: false, jobType };
      }
    }
  }

  private resolveJobMaxAttempts(
    jobType: (typeof JOB_TYPES)[keyof typeof JOB_TYPES],
  ): number {
    switch (jobType) {
      case JOB_TYPES.REQUEST_ENERGY:
      case JOB_TYPES.REQUEST_BUY_ENERGY:
        return this.config.energy.maxRetryCount;
      case JOB_TYPES.REQUEST_FORWARD:
        return this.config.forward.maxRetryCount;
      case JOB_TYPES.SEND_BUY:
        return this.config.buy.maxRetryCount;
      case JOB_TYPES.RECONCILE_ORDER:
        return 3;
      case JOB_TYPES.EXPIRE_ORDER:
        return 1;
      case JOB_TYPES.REPROCESS_PROVIDER_EVENT:
        return 3;
      case JOB_TYPES.MARK_MANUAL_REVIEW:
        return 1;
    }
  }

  private async hasUnresolvedOutcomeUnknown(orderId: string): Promise<boolean> {
    const [energy, forward, send] = await Promise.all([
      EnergyRequestModel.exists({ orderId, status: 'OUTCOME_UNKNOWN' }).exec(),
      ForwardRequestModel.exists({ orderId, status: 'OUTCOME_UNKNOWN' }).exec(),
      SendRequestModel.exists({ orderId, status: 'OUTCOME_UNKNOWN' }).exec(),
    ]);

    return Boolean(energy || forward || send);
  }
}
