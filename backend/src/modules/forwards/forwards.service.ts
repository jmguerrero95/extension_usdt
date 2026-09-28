import type { FastifyBaseLogger } from 'fastify';

import type { AppConfig } from '../../app/config/env';
import { AppError } from '../../app/errors/app-error';
import type { Order } from '../../domain/entities/order.entity';
import type { ForwardRequest } from '../../domain/entities/forward-request.entity';
import type { ForwardRequestRepository } from '../../domain/repositories/forward-request.repository';
import type { SendRequestRepository } from '../../domain/repositories/send-request.repository';
import type {
  TronService,
  TronUsdtTransfer,
  TronUsdtTransferByTxid,
} from '../../infrastructure/blockchain/tron.service';
import { ensureForwardAllowed } from '../../domain/services/forward-policy.service';
import { ensureBuySendAllowed } from '../../domain/services/send-policy.service';
import { isOutcomeUnknownError } from '../../domain/services/external-operation-outcome.service';
import type { MongoLockService } from '../../infrastructure/locks/mongo-lock.service';
import {
  CryptoCurrencyApiBadResponseError,
  CryptoCurrencyApiTimeoutError,
} from '../../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.errors';
import type { OutboxService } from '../../infrastructure/queue/outbox.service';
import type { CryptoCurrencyApiNormalizedWebhook } from '../../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.types';
import type { CryptoCurrencyApiService } from '../../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.service';
import { JOB_TYPES } from '../../shared/constants/job-types';
import type { ActorContext } from '../../shared/types/actor';
import type { ExternalEffectGuard } from '../../jobs/external-effect-guard';
import type { FinancialJobExecutionContext } from '../../jobs/financial-job-execution-context';
import type { OrdersService } from '../orders/orders.service';

const FORWARD_ALLOWED_STATUSES = [
  'ENERGY_CONFIRMED',
  'FORWARD_REQUESTED',
  'ERROR_RETRYABLE',
] as const;

const SEND_ALLOWED_STATUSES = [
  'ENERGY_CONFIRMED',
  'SEND_REQUESTED',
  'ERROR_RETRYABLE',
] as const;
const TRON_USDT_AMOUNT_EPSILON = 0.000001;

type BuySendBlockchainCheckResult =
  | {
      status: 'confirmed';
      order: Order;
      transfer: TronUsdtTransferByTxid;
    }
  | {
      status: 'not_found' | 'waiting_confirmations' | 'mismatch';
      transfer: TronUsdtTransferByTxid | null;
      mismatchField?: 'destination' | 'amount' | 'sender';
    };

const classifyCryptoCurrencyApiRequestState = (
  state: number | null,
): 'PENDING' | 'BROADCASTED' | 'CONFIRMED' | 'FAILED' => {
  if (state === null || [0, 1, 3].includes(state)) {
    return 'PENDING';
  }

  if ([2, 4, 5, 6].includes(state)) {
    return 'BROADCASTED';
  }

  if (state === 7) {
    return 'CONFIRMED';
  }

  if ([8, 9].includes(state)) {
    return 'FAILED';
  }

  return 'PENDING';
};

export class ForwardsService {
  public constructor(
    private readonly config: AppConfig,
    private readonly forwardRequestRepository: ForwardRequestRepository,
    private readonly sendRequestRepository: SendRequestRepository,
    private readonly ordersService: OrdersService,
    private readonly cryptoCurrencyApiService: CryptoCurrencyApiService,
    private readonly tronService: TronService,
    private readonly outboxService: OutboxService,
    private readonly lockService: MongoLockService,
    private readonly logger: FastifyBaseLogger,
    private readonly externalEffectGuard?: ExternalEffectGuard,
  ) {}

  public async requestForward(
    orderId: string,
    actor: ActorContext,
    executionContext?: FinancialJobExecutionContext,
  ) {
    const lockLease = await this.lockService.acquireLease(`order:${orderId}`);
    if (!lockLease) {
      throw new AppError({
        code: 'LOCK_NOT_ACQUIRED',
        statusCode: 409,
        message: 'No fue posible adquirir el lock de la orden para iniciar el forward.',
      });
    }

    try {
      const order = await this.ordersService.getOrderOrFail(orderId);
      if (order.type !== 'SELL') {
        throw new AppError({
          code: 'INVALID_STATE_TRANSITION',
          statusCode: 409,
          message: 'El endpoint de forward solo aplica a órdenes SELL.',
        });

      }

      if (order.manualReviewRequired || order.status === 'ERROR_MANUAL_REVIEW') {
        throw new AppError({
          code: 'MANUAL_REVIEW_REQUIRED',
          statusCode: 422,
          message: 'La orden no puede ejecutar forward porque esta en revision manual.',
        });
      }

      if (
        !FORWARD_ALLOWED_STATUSES.includes(
          order.status as (typeof FORWARD_ALLOWED_STATUSES)[number],
        )
      ) {
        if (
          ['FORWARD_ACCEPTED', 'SWEEP_CONFIRMED', 'READY_FOR_PAYOUT', 'COMPLETED'].includes(
            order.status,
          )
        ) {
          return {
            order,
            forwardRequest: await this.forwardRequestRepository.findLatestByOrderId(orderId),
            skipped: true,
          };
        }

        throw new AppError({
          code: 'ENERGY_NOT_CONFIRMED',
          statusCode: 409,
          message: 'La orden no tiene energía confirmada para ejecutar el forward.',
          details: {
            status: order.status,
          },
        });

      }

      const activeForwardRequest = await this.forwardRequestRepository.findActiveByOrderId(orderId);
      if (activeForwardRequest) {
        return {
          order,
          forwardRequest: activeForwardRequest,
          skipped: true,
        };
      }

      if (!order.depositAddress || !order.forwardTargetAddress) {
        throw new AppError({
          code: 'FORWARD_REQUEST_FAILED',
          statusCode: 422,
          message: 'La orden SELL no tiene configuradas las direcciones requeridas para forward.',
        });

      }

      const amount = ensureForwardAllowed(order, this.config.orders.minOperationalUsdt);
      const params = this.cryptoCurrencyApiService.buildForwardParams({
        orderId,
        fromAddress: order.depositAddress,
        toAddress: order.forwardTargetAddress,
        amount,
      });

      this.logger.info(
        {
          orderId,
          provider: 'cryptocurrencyapi',
          amount,
          fromAddress: order.depositAddress,
          toAddress: order.forwardTargetAddress,
        },
        'sell_prepared_forward_send_requested',
      );

      await this.ordersService.transitionOrder(order, 'FORWARD_REQUESTED', {
        actor,
        reason: 'Solicitud de forward enviada a CryptoCurrencyAPI.',
        metadata: {
          amount,
          fromAddress: order.depositAddress,
          toAddress: order.forwardTargetAddress,
        },
      });

      const createdRequest = await this.forwardRequestRepository.create({
        orderId,
        provider: 'cryptocurrencyapi',
        fromAddress: order.depositAddress,
        toAddress: order.forwardTargetAddress,
        token: this.config.tron.usdtTokenSymbol,
        amount,
        providerRequestId: null,
        providerResponseRaw: null,
        txid: null,
        status: 'REQUESTED',
        requestedAt: new Date(),
        confirmedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      try {
        if (executionContext) {
          await this.externalEffectGuard?.assertExternalEffectStillAllowed(executionContext, {
            operationType: 'FORWARD',
            allowedOrderStatuses: ['FORWARD_REQUESTED'],
            allowedRequestId: createdRequest.id ?? null,
          });
        }
        await this.ordersService.assertExternalEffectsAllowed(orderId, ['FORWARD_REQUESTED']);
        const response = await this.cryptoCurrencyApiService.sendPreparedForward(params);
        const updatedForwardRequest = await this.forwardRequestRepository.updateById(
          createdRequest.id as string,
          {
            providerRequestId: response.providerRequestId,
            providerResponseRaw: response.raw,
            status: 'ACCEPTED',
          },
        );

        this.logger.info(
          {
            orderId,
            provider: 'cryptocurrencyapi',
            providerRequestId: response.providerRequestId,
          },
          'forward_request_accepted_immediately',
        );

        const updatedOrder = await this.ordersService.transitionOrder(orderId, 'FORWARD_ACCEPTED', {
          actor,
          reason: 'CryptoCurrencyAPI aceptó la solicitud asíncrona de forward.',
          patch: {
            providerForwardRequestId: response.providerRequestId,
          },
          metadata: {
            providerRequestId: response.providerRequestId,
          },
        });

        await this.enqueueImmediateReconcileOnForwardAccept(orderId, response.providerRequestId);

        return {
          order: updatedOrder,
          forwardRequest: updatedForwardRequest,
          skipped: false,
        };
      } catch (error) {
        await this.forwardRequestRepository.updateById(createdRequest.id as string, {
          status: isOutcomeUnknownError(error, 'forward_request') ? 'OUTCOME_UNKNOWN' : 'FAILED',
          providerResponseRaw:
            error instanceof Error
              ? {
                  errorName: error.name,
                  errorMessage: error.message,
                  outcomeUncertain: isOutcomeUnknownError(error, 'forward_request'),
                }
              : undefined,
        });

        if (isOutcomeUnknownError(error, 'forward_request')) {
          await this.ordersService.markManualReview(
            orderId,
            actor,
            'Error ambiguo al solicitar forward a CryptoCurrencyAPI; el resultado es incierto y requiere revision manual.',
            {
              outcomeUncertain: true,
              lastErrorCode: error instanceof CryptoCurrencyApiTimeoutError ? 'PROVIDER_TIMEOUT' : 'PROVIDER_BAD_RESPONSE',
              lastErrorMessage: error instanceof Error ? error.message : 'unknown_error',
              lastAttemptAt: new Date().toISOString(),
              provider: 'cryptocurrencyapi',
              operationType: 'forward',
            },
          );

          throw new AppError({
            code: 'PROVIDER_TIMEOUT',
            statusCode: 503,
            message: 'CryptoCurrencyAPI no respondio a tiempo al solicitar el forward.',
          });

        }

        if (error instanceof CryptoCurrencyApiBadResponseError) {
          this.logger.warn(
            {
              orderId,
              provider: 'cryptocurrencyapi',
              amount,
              fromAddress: order.depositAddress,
              toAddress: order.forwardTargetAddress,
              err: error,
            },
            'sell_prepared_forward_send_failed',
          );
          await this.ordersService.transitionOrder(orderId, 'ERROR_RETRYABLE', {
            actor,
            reason: 'CryptoCurrencyAPI respondió con error al solicitar el forward.',
            errorCode: 'FORWARD_REQUEST_FAILED',
            errorMessage: error.message,
          });

          throw new AppError({
            code: 'FORWARD_REQUEST_FAILED',
            statusCode: 502,
            message: 'CryptoCurrencyAPI no aceptó la solicitud de forward.',
            details: error.details,
          });
        }

        throw error;
      }
    } finally {
      await this.lockService.releaseLease(lockLease);
    }
  }

  public async requestBuySend(
    orderId: string,
    actor: ActorContext,
    executionContext?: FinancialJobExecutionContext,
  ) {
    const lockLease = await this.lockService.acquireLease(`order:${orderId}`);
    if (!lockLease) {
      throw new AppError({
        code: 'LOCK_NOT_ACQUIRED',
        statusCode: 409,
        message: 'No fue posible adquirir el lock de la orden para iniciar el envío BUY.',
      });
    }

    try {
      const order = await this.ordersService.getOrderOrFail(orderId);
      if (order.type !== 'BUY') {
        throw new AppError({
          code: 'INVALID_STATE_TRANSITION',
          statusCode: 409,
          message: 'El endpoint de envío BUY solo aplica a órdenes BUY.',
        });

      }

      if (order.manualReviewRequired || order.status === 'ERROR_MANUAL_REVIEW') {
        throw new AppError({
          code: 'MANUAL_REVIEW_REQUIRED',
          statusCode: 422,
          message: 'La orden no puede ejecutar envio porque esta en revision manual.',
        });
      }

      if (
        !SEND_ALLOWED_STATUSES.includes(order.status as (typeof SEND_ALLOWED_STATUSES)[number])
      ) {
        if (
          ['SEND_ACCEPTED', 'SEND_BROADCASTED', 'DELIVERY_CONFIRMED', 'READY_FOR_PAYOUT', 'COMPLETED'].includes(
            order.status,
          )
        ) {
          return {
            order,
            sendRequest: await this.sendRequestRepository.findLatestByOrderId(orderId),
            skipped: true,
          };
        }

        throw new AppError({
          code: 'ENERGY_NOT_CONFIRMED',
          statusCode: 409,
          message: 'La orden BUY no tiene energía confirmada para ejecutar el envío.',
          details: {
            status: order.status,
          },
        });
      }

      const activeSendRequest = await this.sendRequestRepository.findActiveByOrderId(orderId);
      if (activeSendRequest) {
        return {
          order,
          sendRequest: activeSendRequest,
          skipped: true,
        };
      }

      const amount = ensureBuySendAllowed(order, this.config.orders.minOperationalUsdtBuy);
      const params = this.cryptoCurrencyApiService.buildSendParams({
        orderId,
        fromAddress: order.buySenderAddress as string,
        toAddress: order.customerDestinationAddress as string,
        amount,
      });

      await this.ordersService.transitionOrder(order, 'SEND_REQUESTED', {
        actor,
        reason: 'Solicitud de envío BUY enviada a CryptoCurrencyAPI.',
        metadata: {
          amount,
          fromAddress: order.buySenderAddress,
          toAddress: order.customerDestinationAddress,
        },
      });

      const createdRequest = await this.sendRequestRepository.create({
        orderId,
        provider: 'cryptocurrencyapi',
        fromAddress: order.buySenderAddress as string,
        toAddress: order.customerDestinationAddress as string,
        token: this.config.tron.usdtTokenSymbol,
        amount,
        providerRequestId: null,
        providerResponseRaw: null,
        txid: null,
        status: 'REQUESTED',
        requestedAt: new Date(),
        confirmedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      try {
        if (executionContext) {
          await this.externalEffectGuard?.assertExternalEffectStillAllowed(executionContext, {
            operationType: 'SEND_BUY',
            allowedOrderStatuses: ['SEND_REQUESTED'],
            allowedRequestId: createdRequest.id ?? null,
          });
        }
        await this.ordersService.assertExternalEffectsAllowed(orderId, ['SEND_REQUESTED']);
        const response = await this.cryptoCurrencyApiService.sendFunds(params);
        const updatedSendRequest = await this.sendRequestRepository.updateById(
          createdRequest.id as string,
          {
            providerRequestId: response.providerRequestId,
            providerResponseRaw: response.raw,
            status: 'ACCEPTED',
          },
        );

        const updatedOrder = await this.ordersService.transitionOrder(orderId, 'SEND_ACCEPTED', {
          actor,
          reason: 'CryptoCurrencyAPI aceptó la solicitud asíncrona de envío BUY.',
          patch: {
            providerSendRequestId: response.providerRequestId,
          },
          metadata: {
            providerRequestId: response.providerRequestId,
          },
        });

        return {
          order: updatedOrder,
          sendRequest: updatedSendRequest,
          skipped: false,
        };
      } catch (error) {
        await this.sendRequestRepository.updateById(createdRequest.id as string, {
          status: isOutcomeUnknownError(error, 'send_request') ? 'OUTCOME_UNKNOWN' : 'FAILED',
          providerResponseRaw:
            error instanceof Error
              ? {
                  errorName: error.name,
                  errorMessage: error.message,
                  outcomeUncertain: isOutcomeUnknownError(error, 'send_request'),
                }
              : undefined,
        });

        if (isOutcomeUnknownError(error, 'send_request')) {
          await this.ordersService.markManualReview(
            orderId,
            actor,
            'Error ambiguo al solicitar envio BUY a CryptoCurrencyAPI; el resultado es incierto y requiere revision manual.',
            {
              outcomeUncertain: true,
              lastErrorCode: error instanceof CryptoCurrencyApiTimeoutError ? 'PROVIDER_TIMEOUT' : 'PROVIDER_BAD_RESPONSE',
              lastErrorMessage: error instanceof Error ? error.message : 'unknown_error',
              lastAttemptAt: new Date().toISOString(),
              provider: 'cryptocurrencyapi',
              operationType: 'send',
            },
          );

          throw new AppError({
            code: 'PROVIDER_TIMEOUT',
            statusCode: 503,
            message: 'CryptoCurrencyAPI no respondio a tiempo al solicitar el envio BUY.',
          });

        }

        if (error instanceof CryptoCurrencyApiBadResponseError) {
          await this.ordersService.transitionOrder(orderId, 'ERROR_RETRYABLE', {
            actor,
            reason: 'CryptoCurrencyAPI respondió con error al solicitar el envío BUY.',
            errorCode: 'SEND_REQUEST_FAILED',
            errorMessage: error.message,
          });

          throw new AppError({
            code: 'SEND_REQUEST_FAILED',
            statusCode: 502,
            message: 'CryptoCurrencyAPI no aceptó la solicitud de envío BUY.',
            details: error.details,
          });
        }

        throw error;
      }
    } finally {
      await this.lockService.releaseLease(lockLease);
    }
  }

  public async handleForwardWebhook(
    orderId: string,
    event: CryptoCurrencyApiNormalizedWebhook,
    actor: ActorContext,
  ) {
    const lockLease = await this.lockService.acquireLease(`order:${orderId}`);
    if (!lockLease) {
      throw new AppError({
        code: 'LOCK_NOT_ACQUIRED',
        statusCode: 409,
        message: 'No fue posible adquirir el lock de la orden para procesar el forward.',
      });
    }

    try {
      const order = await this.ordersService.getOrderOrFail(orderId);
      if (order.type !== 'SELL') {
        return order;
      }

      const latestRequest = await this.forwardRequestRepository.findLatestByOrderId(orderId);
      const normalizedStatus = event.status?.toLowerCase() ?? '';
      const isConfirmed =
        normalizedStatus.includes('confirmed') ||
        normalizedStatus.includes('done') ||
        normalizedStatus.includes('completed');

      if (latestRequest?.id) {
        await this.forwardRequestRepository.updateById(latestRequest.id, {
          providerRequestId: latestRequest.providerRequestId ?? event.requestId,
          txid: event.txid ?? latestRequest.txid,
          status: isConfirmed ? 'CONFIRMED' : 'ACCEPTED',
          confirmedAt: isConfirmed ? new Date() : latestRequest.confirmedAt,
          providerResponseRaw: event.rawPayload,
        } as Partial<ForwardRequest>);
      }

      this.logger.info(
        {
          orderId,
          provider: 'cryptocurrencyapi',
          eventType: event.eventType,
          requestId: event.requestId,
          txid: event.txid,
          externalStatus: event.status,
          classifiedState: isConfirmed ? 'CONFIRMED' : 'PENDING',
        },
        'Webhook de forward procesado',
      );

      if (isConfirmed) {
        let updatedOrder = order;
        if (updatedOrder.status === 'FORWARD_REQUESTED') {
          this.logger.info(
            {
              orderId,
              provider: 'cryptocurrencyapi',
              currentStatus: updatedOrder.status,
              nextStatus: 'FORWARD_ACCEPTED',
            },
            'Aplicando transicion interna por aceptacion de forward',
          );
          updatedOrder = await this.ordersService.transitionOrder(updatedOrder, 'FORWARD_ACCEPTED', {
            actor,
            reason:
              'CryptoCurrencyAPI confirmó la aceptación del forward antes del barrido.',
            patch: {
              providerForwardRequestId: event.requestId ?? updatedOrder.providerForwardRequestId,
            },
          });
        }

        if (
          updatedOrder.status !== 'SWEEP_CONFIRMED' &&
          updatedOrder.status !== 'READY_FOR_PAYOUT'
        ) {
          this.logger.info(
            {
              orderId,
              provider: 'cryptocurrencyapi',
              currentStatus: updatedOrder.status,
              nextStatus: 'SWEEP_CONFIRMED',
            },
            'Aplicando transicion interna por sweep confirmado',
          );
          updatedOrder = await this.ordersService.transitionOrder(
            updatedOrder,
            'SWEEP_CONFIRMED',
            {
              actor,
              reason:
                'CryptoCurrencyAPI notificó el barrido confirmado hacia la wallet central.',
              patch: {
                providerForwardTxid: event.txid,
              },
              metadata: {
                txid: event.txid,
              },
            },
          );
        }

        if (updatedOrder.cashPayoutConfirmedAt !== null && updatedOrder.status !== 'COMPLETED') {
          this.logger.info(
            {
              orderId,
              provider: 'cryptocurrencyapi',
              currentStatus: updatedOrder.status,
              nextStatus: 'COMPLETED',
            },
            'Aplicando transicion interna por settlement confirmado con cash payout ya registrado',
          );
          updatedOrder = await this.ordersService.transitionOrder(updatedOrder, 'COMPLETED', {
            actor,
            reason:
              'El settlement SELL termino despues de que CAS ya habia confirmado la entrega de efectivo.',
            patch: {
              providerForwardTxid: event.txid,
            },
            metadata: {
              txid: event.txid,
              source: 'settlement-after-cash-payout',
            },
          });
        } else if (updatedOrder.status !== 'READY_FOR_PAYOUT') {
          this.logger.info(
            {
              orderId,
              provider: 'cryptocurrencyapi',
              currentStatus: updatedOrder.status,
              nextStatus: 'READY_FOR_PAYOUT',
            },
            'Aplicando transicion interna por cierre operativo de forward',
          );
          updatedOrder = await this.ordersService.transitionOrder(
            updatedOrder,
            'READY_FOR_PAYOUT',
            {
              actor,
              reason: 'La orden quedó lista para payout tras la confirmación del sweep.',
              patch: {
                providerForwardTxid: event.txid,
              },
            });
        }

        return updatedOrder;
      }

      if (order.status === 'FORWARD_REQUESTED') {
        this.logger.info(
          {
            orderId,
            provider: 'cryptocurrencyapi',
            currentStatus: order.status,
            nextStatus: 'FORWARD_ACCEPTED',
          },
          'Webhook de forward aceptado sin confirmacion final',
        );
        const acceptedOrder = await this.ordersService.transitionOrder(order, 'FORWARD_ACCEPTED', {
          actor,
          reason: 'CryptoCurrencyAPI reportó que la solicitud de forward quedó en cola.',
          patch: {
            providerForwardRequestId: event.requestId ?? order.providerForwardRequestId,
          },
          metadata: {
            providerRequestId: event.requestId,
          },
        });

        await this.enqueueImmediateReconcileOnForwardAccept(
          orderId,
          event.requestId ?? order.providerForwardRequestId,
        );

        return acceptedOrder;
      }

      if (order.status === 'FORWARD_ACCEPTED') {
        this.logger.info(
          {
            orderId,
            provider: 'cryptocurrencyapi',
            currentStatus: order.status,
            requestId: event.requestId,
            txid: event.txid,
            externalStatus: event.status,
          },
          'forward_webhook_compatible_with_preaccepted_state',
        );
      }

      return order;
    } finally {
      await this.lockService.releaseLease(lockLease);
    }
  }

  public async handleSendWebhook(
    orderId: string,
    event: CryptoCurrencyApiNormalizedWebhook,
    actor: ActorContext,
  ) {
    const lockLease = await this.lockService.acquireLease(`order:${orderId}`);
    if (!lockLease) {
      throw new AppError({
        code: 'LOCK_NOT_ACQUIRED',
        statusCode: 409,
        message: 'No fue posible adquirir el lock de la orden para procesar el envío BUY.',
      });
    }

    try {
      const order = await this.ordersService.getOrderOrFail(orderId);
      if (order.type !== 'BUY') {
        return order;
      }

      const latestRequest = await this.sendRequestRepository.findLatestByOrderId(orderId);
      const normalizedStatus = event.status?.toLowerCase() ?? '';
      const isConfirmed =
        normalizedStatus.includes('confirmed') ||
        normalizedStatus.includes('done') ||
        normalizedStatus.includes('completed');
      const isBroadcasted = Boolean(event.txid) || normalizedStatus.includes('broadcast');

      this.logger.info(
        {
          orderId,
          provider: 'cryptocurrencyapi',
          eventType: event.eventType,
          requestId: event.requestId,
          txid: event.txid,
          externalStatus: event.status,
          classifiedState: isConfirmed ? 'CONFIRMED' : isBroadcasted ? 'BROADCASTED' : 'PENDING',
        },
        'Webhook de send BUY procesado',
      );

      if (latestRequest?.id) {
        await this.sendRequestRepository.updateById(latestRequest.id, {
          providerRequestId: latestRequest.providerRequestId ?? event.requestId,
          txid: event.txid ?? latestRequest.txid,
          status: isConfirmed ? 'CONFIRMED' : isBroadcasted ? 'BROADCASTED' : 'ACCEPTED',
          confirmedAt: isConfirmed ? new Date() : latestRequest.confirmedAt,
          providerResponseRaw: event.rawPayload,
        });
      }

      let updatedOrder = order;

      if (updatedOrder.status === 'SEND_REQUESTED') {
        this.logger.info(
          {
            orderId,
            provider: 'cryptocurrencyapi',
            currentStatus: updatedOrder.status,
            nextStatus: 'SEND_ACCEPTED',
          },
          'Aplicando transicion interna por aceptacion de send BUY',
        );
        updatedOrder = await this.ordersService.transitionOrder(updatedOrder, 'SEND_ACCEPTED', {
          actor,
          reason: 'CryptoCurrencyAPI reportó que el envío BUY fue aceptado por la cola asíncrona.',
          patch: {
            providerSendRequestId: event.requestId ?? updatedOrder.providerSendRequestId,
          },
          metadata: {
            providerRequestId: event.requestId,
          },
        });
      }

      if (
        isBroadcasted &&
        !['SEND_BROADCASTED', 'DELIVERY_CONFIRMED', 'COMPLETED'].includes(updatedOrder.status)
      ) {
        const sendBroadcastedAt = updatedOrder.sendBroadcastedAt ?? new Date();
        if (!updatedOrder.sendBroadcastedAt) {
          this.logger.info(
            {
              orderId,
              sendTxid: event.txid,
              sendBroadcastedAt: sendBroadcastedAt.toISOString(),
            },
            'buy_send_broadcasted_at_set',
          );
        }

        this.logger.info(
          {
            orderId,
            provider: 'cryptocurrencyapi',
            currentStatus: updatedOrder.status,
            nextStatus: 'SEND_BROADCASTED',
          },
          'Aplicando transicion interna por envio BUY broadcasted',
        );
        updatedOrder = await this.ordersService.transitionOrder(updatedOrder, 'SEND_BROADCASTED', {
          actor,
          reason: 'CryptoCurrencyAPI notificó que el envío BUY fue emitido en cadena.',
          patch: {
            providerSendTxid: event.txid ?? updatedOrder.providerSendTxid,
            sendBroadcastedAt,
          },
          metadata: {
            txid: event.txid,
          },
        });
        if (event.txid) {
          await this.outboxService.enqueueUniqueNow({
            jobType: JOB_TYPES.RECONCILE_ORDER,
            orderId,
            maxAttempts: 3,
            payload: {
              reason: 'immediate_reconcile_on_broadcast',
            },
          });

          this.logger.info(
            {
              orderId,
              txid: event.txid,
              reason: 'immediate_reconcile_on_broadcast',
            },
            'buy_send_reconcile_enqueued',
          );
        }
      }

      if (isConfirmed && !['DELIVERY_CONFIRMED', 'COMPLETED'].includes(updatedOrder.status)) {
        this.logger.info(
          {
            orderId,
            provider: 'cryptocurrencyapi',
            currentStatus: updatedOrder.status,
            nextStatus: 'DELIVERY_CONFIRMED',
          },
          'Aplicando transicion interna por entrega confirmada de send BUY',
        );
        updatedOrder = await this.ordersService.transitionOrder(
          updatedOrder,
          'DELIVERY_CONFIRMED',
          {
            actor,
            reason: 'CryptoCurrencyAPI confirmó la entrega del envío BUY.',
            patch: {
              providerSendTxid: event.txid ?? updatedOrder.providerSendTxid,
            },
            metadata: {
              txid: event.txid,
            },
          },
        );
      }

      if (isConfirmed && updatedOrder.status !== 'COMPLETED') {
        this.logger.info(
          {
            orderId,
            provider: 'cryptocurrencyapi',
            currentStatus: updatedOrder.status,
            nextStatus: 'COMPLETED',
          },
          'Aplicando transicion interna por cierre exitoso de send BUY',
        );
        updatedOrder = await this.ordersService.transitionOrder(updatedOrder, 'COMPLETED', {
          actor,
          reason: 'La orden BUY quedó completada tras la confirmación del envío.',
          patch: {
            providerSendTxid: event.txid ?? updatedOrder.providerSendTxid,
          },
        });
      }

      return updatedOrder;
    } finally {
      await this.lockService.releaseLease(lockLease);
    }
  }

  public async reconcilePendingForward(orderId: string, actor: ActorContext) {
    const order = await this.ordersService.getOrderOrFail(orderId);
    if (
      order.type !== 'SELL' ||
      !['FORWARD_REQUESTED', 'FORWARD_ACCEPTED'].includes(order.status)
    ) {
      return order;
    }

    const latestRequest = await this.forwardRequestRepository.findLatestByOrderId(orderId);
    if (!latestRequest) {
      return order;
    }

    const forwardTxid = order.providerForwardTxid ?? latestRequest.txid ?? null;
    if (forwardTxid && ['FORWARD_REQUESTED', 'FORWARD_ACCEPTED'].includes(order.status)) {
      const confirmedByBlockchain = await this.confirmSellForwardByBlockchain(
        {
          ...order,
          providerForwardTxid: forwardTxid,
        },
        latestRequest,
        actor,
      );

      if (confirmedByBlockchain) {
        return confirmedByBlockchain;
      }
    }

    const statusResult = await this.cryptoCurrencyApiService.getRequestStatusWithLookup(
      {
        requestId: latestRequest.providerRequestId ?? order.providerForwardRequestId ?? undefined,
        uniqID: `forward_${orderId}`,
        label: `forward|${orderId}`,
      },
      {
        lookupOrder: ['requestId', 'uniqID', 'label'],
      },
    );
    const status = statusResult.status;
    const requestState = classifyCryptoCurrencyApiRequestState(status.state);

    this.logger.info(
      {
        orderId,
        provider: 'cryptocurrencyapi',
        correlationField: statusResult.lookupField,
        providerRequestId: latestRequest.providerRequestId ?? order.providerForwardRequestId,
        externalState: status.state,
        classifiedState: requestState,
        txid: status.txid,
      },
      'Consulta de reconciliacion a CryptoCurrencyAPI para forward',
    );

    if (latestRequest.id) {
      await this.forwardRequestRepository.updateById(latestRequest.id, {
        providerRequestId: latestRequest.providerRequestId ?? status.requestId,
        txid: status.txid ?? latestRequest.txid,
        status:
          requestState === 'CONFIRMED'
            ? 'CONFIRMED'
            : requestState === 'FAILED'
              ? 'FAILED'
              : 'ACCEPTED',
        confirmedAt: requestState === 'CONFIRMED' ? new Date() : latestRequest.confirmedAt,
        providerResponseRaw: status.raw,
      });
    }

    if (requestState === 'FAILED') {
      return this.ordersService.transitionOrder(order, 'ERROR_RETRYABLE', {
        actor,
        reason: 'CryptoCurrencyAPI devolvio un estado terminal fallido para el forward.',
        errorCode: 'FORWARD_REQUEST_FAILED',
        errorMessage:
          status.result ?? (status.state !== null ? `cryptocurrencyapi_state_${status.state}` : undefined),
        metadata: {
          providerRequestId: status.requestId,
          state: status.state,
          txid: status.txid,
        },
      });
    }

    if (requestState === 'CONFIRMED') {
      return this.handleForwardWebhook(
        orderId,
        {
          eventType: 'forward',
          address: status.toAddress,
          label: status.label,
          uniqID: status.uniqID,
          txid: status.txid,
          token: status.token,
          network: 'TRON',
          amount: status.amount,
          confirmations: null,
          status: 'forward_confirmed',
          requestId: status.requestId,
          rawPayload: status.raw,
        },
        actor,
      );
    }

    return order;
  }

  public async reconcilePendingSend(orderId: string, actor: ActorContext) {
    const order = await this.ordersService.getOrderOrFail(orderId);
    if (
      order.type !== 'BUY' ||
      !['SEND_REQUESTED', 'SEND_ACCEPTED', 'SEND_BROADCASTED'].includes(order.status)
    ) {
      return order;
    }

    const latestRequest = await this.sendRequestRepository.findLatestByOrderId(orderId);
    if (!latestRequest) {
      return order;
    }

    const sendTxid = order.providerSendTxid ?? latestRequest.txid ?? null;
    let blockchainCheck: BuySendBlockchainCheckResult = {
      status: 'not_found',
      transfer: null,
    };

    if (sendTxid && ['SEND_ACCEPTED', 'SEND_BROADCASTED'].includes(order.status)) {
      blockchainCheck = await this.confirmBuySendByBlockchain(
        {
          ...order,
          providerSendTxid: sendTxid,
        },
        actor,
      );

      if (blockchainCheck.status === 'confirmed') {
        return blockchainCheck.order;
      }
    }

    this.logger.info(
      {
        orderId,
        sendTxid,
        blockchainStatus: blockchainCheck.status,
        source: 'provider-status',
      },
      'buy_send_confirmation_provider_fallback',
    );

    try {
      const statusResult = await this.cryptoCurrencyApiService.getRequestStatusWithLookup(
        {
          requestId: latestRequest.providerRequestId ?? order.providerSendRequestId ?? undefined,
          uniqID: `send_${orderId}`,
          label: `send|${orderId}`,
        },
        {
          lookupOrder: ['requestId', 'uniqID', 'label'],
        },
      );
      const status = statusResult.status;
      const requestState = classifyCryptoCurrencyApiRequestState(status.state);

      this.logger.info(
        {
          orderId,
          provider: 'cryptocurrencyapi',
          correlationField: statusResult.lookupField,
          providerRequestId: latestRequest.providerRequestId ?? order.providerSendRequestId,
          externalState: status.state,
          classifiedState: requestState,
          txid: status.txid,
        },
        'Consulta de reconciliacion a CryptoCurrencyAPI para send BUY',
      );

      if (latestRequest.id) {
        await this.sendRequestRepository.updateById(latestRequest.id, {
          providerRequestId: latestRequest.providerRequestId ?? status.requestId,
          txid: status.txid ?? latestRequest.txid,
          status:
            requestState === 'CONFIRMED'
              ? 'CONFIRMED'
              : requestState === 'BROADCASTED'
                ? 'BROADCASTED'
                : requestState === 'FAILED'
                  ? 'FAILED'
                  : 'ACCEPTED',
          confirmedAt: requestState === 'CONFIRMED' ? new Date() : latestRequest.confirmedAt,
          providerResponseRaw: status.raw,
        });
      }

      if (requestState === 'FAILED') {
        return this.ordersService.transitionOrder(order, 'ERROR_RETRYABLE', {
          actor,
          reason: 'CryptoCurrencyAPI devolvio un estado terminal fallido para el envio BUY.',
          errorCode: 'SEND_REQUEST_FAILED',
          errorMessage:
            status.result ?? (status.state !== null ? `cryptocurrencyapi_state_${status.state}` : undefined),
          metadata: {
            providerRequestId: status.requestId,
            state: status.state,
            txid: status.txid,
          },
        });
      }

      let nextOrder = order;

      if (requestState === 'BROADCASTED' || requestState === 'CONFIRMED') {
        const allowProviderCompletion = blockchainCheck.status === 'not_found';
        if (requestState === 'CONFIRMED' && !allowProviderCompletion) {
          this.logger.warn(
            {
              orderId,
              txid: status.txid ?? sendTxid,
              blockchainStatus: blockchainCheck.status,
              blockchainMismatchField:
                blockchainCheck.status === 'mismatch'
                  ? blockchainCheck.mismatchField
                  : undefined,
              source: 'provider-status',
            },
            'buy_send_provider_confirmation_deferred_to_blockchain',
          );
        }

        nextOrder = await this.handleSendWebhook(
          orderId,
          {
            eventType: 'send',
            address: status.toAddress,
            label: status.label,
            uniqID: status.uniqID,
            txid: status.txid,
            token: status.token,
            network: 'TRON',
            amount: status.amount,
            confirmations: null,
            status:
              requestState === 'CONFIRMED' && allowProviderCompletion
                ? 'send_confirmed'
                : 'send_broadcasted',
            requestId: status.requestId,
            rawPayload: status.raw,
          },
          actor,
        );
      }

      if (nextOrder.status === 'SEND_BROADCASTED') {
        return this.markBuySendBroadcastedManualReviewIfTimedOut(
          nextOrder,
          actor,
          blockchainCheck,
          {
            providerState: requestState,
            providerTxid: status.txid,
          },
        );
      }

      return nextOrder;
    } catch (error) {
      if (order.status === 'SEND_BROADCASTED') {
        return this.markBuySendBroadcastedManualReviewIfTimedOut(
          order,
          actor,
          blockchainCheck,
          {
            providerStatusError: error instanceof Error ? error.message : 'unknown_error',
          },
        );
      }

      throw error;
    }
  }

  private async confirmBuySendByBlockchain(
    order: Order,
    actor: ActorContext,
  ): Promise<BuySendBlockchainCheckResult> {
    if (
      order.type !== 'BUY' ||
      !order.providerSendTxid ||
      !order.customerDestinationAddress ||
      order.cryptoAmountToSend === null
    ) {
      return {
        status: 'not_found',
        transfer: null,
      };
    }

    this.logger.info(
      {
        orderId: order.orderId,
        sendTxid: order.providerSendTxid,
        expectedDestination: order.customerDestinationAddress,
        expectedAmount: order.cryptoAmountToSend,
        minConfirmations: this.config.buy.minConfirmations,
        source: 'blockchain',
      },
      'buy_txid_verification_started',
    );

    try {
      const transfer = await this.tronService.getUSDTTransferByTxid(order.providerSendTxid);

      if (!transfer) {
        this.logger.info(
          {
            orderId: order.orderId,
            sendTxid: order.providerSendTxid,
            source: 'blockchain',
          },
          'buy_txid_verification_pending',
        );
        return {
          status: 'not_found',
          transfer: null,
        };
      }

      this.logger.info(
        {
          orderId: order.orderId,
          sendTxid: transfer.txid,
          confirmed: transfer.confirmed,
          confirmations: transfer.confirmations,
          actualSender: transfer.from,
          actualDestination: transfer.to,
          actualAmount: transfer.amount,
          source: 'blockchain',
        },
        'buy_txid_found',
      );

      if (!transfer.confirmed || !this.hasEnoughBuyConfirmations(transfer.confirmations)) {
        this.logger.info(
          {
            orderId: order.orderId,
            sendTxid: transfer.txid,
            confirmed: transfer.confirmed,
            confirmations: transfer.confirmations,
            minConfirmations: this.config.buy.minConfirmations,
            source: 'blockchain',
          },
          'buy_txid_waiting_confirmations',
        );
        return {
          status: 'waiting_confirmations',
          transfer,
        };
      }

      if (transfer.to !== order.customerDestinationAddress) {
        this.logger.warn(
          {
            orderId: order.orderId,
            sendTxid: order.providerSendTxid,
            expectedDestination: order.customerDestinationAddress,
            actualDestination: transfer.to,
            source: 'blockchain',
          },
          'buy_tx_destination_mismatch',
        );
        return {
          status: 'mismatch',
          transfer,
          mismatchField: 'destination',
        };
      }

      if (!this.buyAmountMatches(transfer.amount, order.cryptoAmountToSend)) {
        this.logger.warn(
          {
            orderId: order.orderId,
            sendTxid: order.providerSendTxid,
            expectedAmount: order.cryptoAmountToSend,
            actualAmount: transfer.amount,
            tolerance: this.config.buy.sendAmountTolerance,
            source: 'blockchain',
          },
          'buy_tx_amount_mismatch',
        );
        return {
          status: 'mismatch',
          transfer,
          mismatchField: 'amount',
        };
      }

      const senderMatches =
        !order.buySenderAddress || !transfer.from || transfer.from === order.buySenderAddress;
      if (!senderMatches) {
        this.logger.warn(
          {
            orderId: order.orderId,
            sendTxid: order.providerSendTxid,
            expectedSender: order.buySenderAddress,
            actualSender: transfer.from,
            strictSenderMatch: this.config.buy.requireExactSenderMatch,
            source: 'blockchain',
          },
          'buy_tx_sender_mismatch',
        );

        if (this.config.buy.requireExactSenderMatch) {
          return {
            status: 'mismatch',
            transfer,
            mismatchField: 'sender',
          };
        }
      }

      this.logger.info(
        {
          orderId: order.orderId,
          sendTxid: order.providerSendTxid,
          confirmations: transfer.confirmations,
          actualDestination: transfer.to,
          actualAmount: transfer.amount,
          source: 'blockchain',
        },
        'buy_blockchain_confirmation_succeeded',
      );

      const confirmedOrder = await this.handleSendWebhook(
        order.orderId,
        {
          eventType: 'send',
          address: transfer.to,
          label: order.providerLabel,
          uniqID: `send_${order.orderId}`,
          txid: transfer.txid,
          token: this.config.tron.usdtTokenSymbol,
          network: 'TRON',
          amount: transfer.amount,
          confirmations: transfer.confirmations ?? this.config.buy.minConfirmations,
          status: 'send_confirmed',
          requestId: order.providerSendRequestId,
          rawPayload: {
            source: 'blockchain',
            txid: transfer.txid,
            from: transfer.from,
            to: transfer.to,
            amount: transfer.amount,
            timestamp: transfer.timestamp,
            confirmed: transfer.confirmed,
            confirmations: transfer.confirmations,
            blockNumber: transfer.blockNumber,
          },
        },
        actor,
      );

      return {
        status: 'confirmed',
        order: confirmedOrder,
        transfer,
      };
    } catch (error) {
      this.logger.warn(
        {
          orderId: order.orderId,
          sendTxid: order.providerSendTxid,
          expectedDestination: order.customerDestinationAddress,
          expectedAmount: order.cryptoAmountToSend,
          provider: 'trongrid',
          err: error,
        },
        'buy_txid_verification_failed',
      );
      return {
        status: 'not_found',
        transfer: null,
      };
    }
  }

  private async markBuySendBroadcastedManualReviewIfTimedOut(
    order: Order,
    actor: ActorContext,
    blockchainCheck: BuySendBlockchainCheckResult,
    details?: Record<string, unknown>,
  ): Promise<Order> {
    if (order.type !== 'BUY' || order.status !== 'SEND_BROADCASTED') {
      return order;
    }

    const timeoutMs = this.config.buy.broadcastedTimeoutMinutes * 60_000;
    const timeoutBaseTimestamp = order.sendBroadcastedAt ?? order.updatedAt;
    const elapsedMs = Date.now() - timeoutBaseTimestamp.getTime();

    this.logger.info(
      {
        orderId: order.orderId,
        sendTxid: order.providerSendTxid,
        timeoutBaseTimestamp: timeoutBaseTimestamp.toISOString(),
        elapsedMinutes: elapsedMs / 60_000,
        timeoutMinutes: this.config.buy.broadcastedTimeoutMinutes,
        source: 'buy-send-reconciliation',
      },
      'buy_send_broadcasted_timeout_evaluated',
    );

    if (elapsedMs < timeoutMs) {
      return order;
    }

    this.logger.warn(
      {
        orderId: order.orderId,
        sendTxid: order.providerSendTxid,
        broadcastedAt: timeoutBaseTimestamp.toISOString(),
        elapsedMinutes: elapsedMs / 60_000,
        timeoutMinutes: this.config.buy.broadcastedTimeoutMinutes,
        blockchainStatus: blockchainCheck.status,
        blockchainMismatchField:
          blockchainCheck.status === 'mismatch' ? blockchainCheck.mismatchField : undefined,
        source: 'buy-send-reconciliation',
        ...details,
      },
      'buy_send_broadcasted_timeout_manual_review',
    );

    return this.ordersService.markManualReview(
      order.orderId,
      actor,
      'La orden BUY excedio el tiempo maximo en SEND_BROADCASTED sin evidencia suficiente para cerrarse automaticamente.',
      {
        source: 'buy-send-broadcasted-timeout',
        sendTxid: order.providerSendTxid,
        broadcastedAt: timeoutBaseTimestamp.toISOString(),
        blockchainStatus: blockchainCheck.status,
        blockchainMismatchField:
          blockchainCheck.status === 'mismatch' ? blockchainCheck.mismatchField : undefined,
        ...details,
      },
    );
  }

  private async confirmSellForwardByBlockchain(
    order: Order,
    latestRequest: ForwardRequest,
    actor: ActorContext,
  ): Promise<Order | null> {
    if (
      order.type !== 'SELL' ||
      !order.providerForwardTxid ||
      !latestRequest.fromAddress ||
      !latestRequest.toAddress
    ) {
      return null;
    }

    this.logger.info(
      {
        orderId: order.orderId,
        forwardTxid: order.providerForwardTxid,
        depositAddress: latestRequest.fromAddress,
        expectedForwardDestination: latestRequest.toAddress,
        expectedAmount: latestRequest.amount,
        source: 'blockchain',
      },
      'sell_forward_confirmation_check_started',
    );

    try {
      const transfer = await this.findConfirmedTransferByTxidWithFallback({
        txid: order.providerForwardTxid,
        primaryAddress: latestRequest.toAddress,
        secondaryAddress:
          latestRequest.fromAddress !== latestRequest.toAddress
            ? latestRequest.fromAddress
            : undefined,
      });

      if (!transfer) {
        this.logger.info(
          {
            orderId: order.orderId,
            forwardTxid: order.providerForwardTxid,
            depositAddress: latestRequest.fromAddress,
            expectedForwardDestination: latestRequest.toAddress,
            expectedAmount: latestRequest.amount,
            actualFrom: null,
            actualTo: null,
            actualAmount: null,
            confirmationStatus: 'pending',
            source: 'blockchain',
          },
          'sell_forward_confirmation_pending',
        );
        return null;
      }

      const sourceMatches = transfer.from === latestRequest.fromAddress;
      const destinationMatches = transfer.to === latestRequest.toAddress;
      const amountMatches = this.amountMatches(transfer.amount, latestRequest.amount);

      if (!sourceMatches || !destinationMatches || !amountMatches) {
        this.logger.warn(
          {
            orderId: order.orderId,
            forwardTxid: order.providerForwardTxid,
            depositAddress: latestRequest.fromAddress,
            expectedForwardDestination: latestRequest.toAddress,
            expectedAmount: latestRequest.amount,
            actualFrom: transfer.from,
            actualTo: transfer.to,
            actualAmount: transfer.amount,
            confirmationStatus: 'mismatch',
            source: 'blockchain',
          },
          'sell_forward_confirmation_mismatch',
        );
        return null;
      }

      this.logger.info(
        {
          orderId: order.orderId,
          forwardTxid: order.providerForwardTxid,
          depositAddress: latestRequest.fromAddress,
          expectedForwardDestination: latestRequest.toAddress,
          expectedAmount: latestRequest.amount,
          actualFrom: transfer.from,
          actualTo: transfer.to,
          actualAmount: transfer.amount,
          confirmationStatus: 'confirmed',
          source: 'blockchain',
        },
        'sell_forward_confirmation_confirmed',
      );

      return this.handleForwardWebhook(
        order.orderId,
        {
          eventType: 'forward',
          address: transfer.to,
          label: order.providerLabel,
          uniqID: `forward_${order.orderId}`,
          txid: transfer.txid,
          token: this.config.tron.usdtTokenSymbol,
          network: 'TRON',
          amount: transfer.amount,
          confirmations: this.config.orders.minConfirmationsUsdtTrc20,
          status: 'forward_confirmed',
          requestId: order.providerForwardRequestId,
          rawPayload: {
            source: 'blockchain',
            txid: transfer.txid,
            from: transfer.from,
            to: transfer.to,
            amount: transfer.amount,
            timestamp: transfer.timestamp,
          },
        },
        actor,
      );
    } catch (error) {
      this.logger.warn(
        {
          orderId: order.orderId,
          forwardTxid: order.providerForwardTxid,
          depositAddress: latestRequest.fromAddress,
          expectedForwardDestination: latestRequest.toAddress,
          expectedAmount: latestRequest.amount,
          provider: 'trongrid',
          err: error,
        },
        'sell_forward_confirmation_pending',
      );
      return null;
    }
  }

  private amountMatches(actualAmount: number, expectedAmount: number): boolean {
    return Math.abs(actualAmount - expectedAmount) <= TRON_USDT_AMOUNT_EPSILON;
  }

  private hasEnoughBuyConfirmations(confirmations: number | null): boolean {
    if (confirmations === null) {
      return this.config.buy.minConfirmations <= 1;
    }

    return confirmations >= this.config.buy.minConfirmations;
  }

  private buyAmountMatches(actualAmount: number, expectedAmount: number): boolean {
    return Math.abs(actualAmount - expectedAmount) <= this.config.buy.sendAmountTolerance;
  }

  private async enqueueImmediateReconcileOnForwardAccept(
    orderId: string,
    providerRequestId: string | null,
  ): Promise<void> {
    await this.outboxService.enqueueUniqueNow({
      jobType: JOB_TYPES.RECONCILE_ORDER,
      orderId,
      maxAttempts: 3,
      payload: {
        reason: 'immediate_reconcile_on_forward_accept',
      },
    });

    this.logger.info(
      {
        orderId,
        providerRequestId,
        reason: 'immediate_reconcile_on_forward_accept',
      },
      'forward_accept_reconcile_enqueued',
    );
  }

  private async findConfirmedTransferByTxidWithFallback(input: {
    txid: string;
    primaryAddress: string;
    secondaryAddress?: string;
  }): Promise<TronUsdtTransfer | null> {
    const primaryTransfer = await this.tronService.findConfirmedUSDTTransferByTxid(
      input.primaryAddress,
      input.txid,
    );

    if (primaryTransfer) {
      return primaryTransfer;
    }

    if (!input.secondaryAddress || input.secondaryAddress === input.primaryAddress) {
      return null;
    }

    return this.tronService.findConfirmedUSDTTransferByTxid(
      input.secondaryAddress,
      input.txid,
    );
  }
}
