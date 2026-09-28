import type { FastifyBaseLogger } from 'fastify';

import type { AppConfig } from '../../app/config/env';
import { AppError } from '../../app/errors/app-error';
import type { Order } from '../../domain/entities/order.entity';
import type { EnergyRequest } from '../../domain/entities/energy-request.entity';
import type { EnergyRequestRepository } from '../../domain/repositories/energy-request.repository';
import { selectEnergyRequestAmount } from '../../domain/services/energy-selection.service';
import { isOutcomeUnknownError } from '../../domain/services/external-operation-outcome.service';
import type { TronService } from '../../infrastructure/blockchain/tron.service';
import type { MongoLockService } from '../../infrastructure/locks/mongo-lock.service';
import { ItrxBadResponseError, ItrxTimeoutError } from '../../infrastructure/providers/itrx/itrx.errors';
import type { ItrxService } from '../../infrastructure/providers/itrx/itrx.service';
import type { OutboxService } from '../../infrastructure/queue/outbox.service';
import { JOB_TYPES } from '../../shared/constants/job-types';
import type { ActorContext } from '../../shared/types/actor';
import type { ExternalEffectGuard } from '../../jobs/external-effect-guard';
import type { FinancialJobExecutionContext } from '../../jobs/financial-job-execution-context';
import type { OrdersService } from '../orders/orders.service';

const SELL_ALLOWED_STATUSES = [
  'DEPOSIT_DETECTED',
  'ENERGY_ESTIMATION_REQUESTED',
  'ENERGY_ESTIMATED',
  'ERROR_RETRYABLE',
] as const;

const BUY_ALLOWED_STATUSES = [
  'CREATED',
  'VALIDATED',
  'ENERGY_ESTIMATION_REQUESTED',
  'ENERGY_ESTIMATED',
  'ERROR_RETRYABLE',
] as const;

const classifyEnergyRequestState = (
  status: number | null,
  _type: string | null,
): 'CONFIRMED' | 'FAILED' | 'PENDING' => {
  if (status !== null && status === 40) {
    return 'CONFIRMED';
  }

  if (status !== null && [0, 41, 43].includes(status)) {
    return 'FAILED';
  }

  if (status !== null) {
    return 'PENDING';
  }

  return 'PENDING';
};

export class EnergyService {
  public constructor(
    private readonly config: AppConfig,
    private readonly energyRequestRepository: EnergyRequestRepository,
    private readonly ordersService: OrdersService,
    private readonly itrxService: ItrxService,
    private readonly tronService: TronService,
    private readonly outboxService: OutboxService,
    private readonly lockService: MongoLockService,
    private readonly logger: FastifyBaseLogger,
    private readonly externalEffectGuard?: ExternalEffectGuard,
  ) {}

  private inferRequestKind(
    energyRequest: EnergyRequest,
  ): NonNullable<EnergyRequest['requestKind']> {
    if (energyRequest.requestKind) {
      return energyRequest.requestKind;
    }

    return energyRequest.energyContext === 'SELL_DEPOSIT' ? 'COLLECTION' : 'SMART_DELEGATE';
  }

  public async requestEnergy(
    orderId: string,
    actor: ActorContext,
    executionContext?: FinancialJobExecutionContext,
  ) {
    return this.requestEnergyForOrder(orderId, 'SELL', actor, executionContext);
  }

  public async requestBuyEnergy(
    orderId: string,
    actor: ActorContext,
    executionContext?: FinancialJobExecutionContext,
  ) {
    return this.requestEnergyForOrder(orderId, 'BUY', actor, executionContext);
  }

  public async handleConfirmedCallback(
    orderId: string,
    callback: {
      energyAmount: number | null;
      payAmount: number | null;
      serial: string | null;
      txid: string | null;
      status: number | null;
      type: string | null;
      receiveAddress: string | null;
      outTradeNo: string | null;
      rawPayload: Record<string, unknown>;
    },
    actor: ActorContext,
  ) {
    const lockLease = await this.lockService.acquireLease(`order:${orderId}`);
    if (!lockLease) {
      throw new AppError({
        code: 'LOCK_NOT_ACQUIRED',
        statusCode: 409,
        message: 'No fue posible adquirir el lock de la orden para confirmar energía.',
      });
    }

    try {
      const order = await this.ordersService.getOrderOrFail(orderId);
      const energyRequest = await this.energyRequestRepository.findLatestByOrderId(orderId);
      const state = classifyEnergyRequestState(callback.status, callback.type);

      this.logger.info(
        {
          orderId,
          provider: 'itrx',
          externalStatus: callback.status,
          externalType: callback.type,
          providerSerial: callback.serial,
          classifiedState: state,
          actorType: actor.actorType,
        },
        'Estado externo de iTRX recibido para energia',
      );

      if (
        energyRequest?.energyContext === 'SELL_DEPOSIT' &&
        actor.actorType === 'provider'
      ) {
        this.logger.info(
          {
            orderId,
            provider: 'itrx',
            receiveAddress: callback.receiveAddress,
            energyContext: energyRequest.energyContext,
            serial: callback.serial,
            status: callback.status,
            source: callback.rawPayload['source'] ?? null,
            responseData: callback.rawPayload,
          },
          'itrx_collection_callback_received',
        );
      }

      if (energyRequest?.id) {
        await this.energyRequestRepository.updateById(energyRequest.id, {
          providerSerial: callback.serial,
          providerResponseRaw: callback.rawPayload,
          status: state,
          signatureValid: actor.actorType === 'provider' ? true : energyRequest.signatureValid,
          confirmedAt: state === 'CONFIRMED' ? new Date() : energyRequest.confirmedAt,
        });
      }

      if (state === 'FAILED' && !order.energyConfirmedAt && order.status !== 'ERROR_RETRYABLE') {
        this.logger.warn(
          {
            orderId,
            provider: 'itrx',
            externalStatus: callback.status,
            externalType: callback.type,
            nextStatus: 'ERROR_RETRYABLE',
          },
          'iTRX reporto un estado fallido para energia',
        );
        return this.ordersService.transitionOrder(order, 'ERROR_RETRYABLE', {
          actor,
          reason:
            order.type === 'BUY'
              ? 'iTRX devolvio un estado terminal fallido para la energia de la wallet BUY.'
              : 'iTRX devolvio un estado terminal fallido para la energia de la deposit address.',
          errorCode: 'ENERGY_REQUEST_FAILED',
          errorMessage:
            callback.type ?? (callback.status !== null ? `itrx_status_${callback.status}` : 'itrx_failed'),
          metadata: {
            serial: callback.serial,
            receiveAddress: callback.receiveAddress,
            status: callback.status,
            type: callback.type,
          },
        });
      }

      if (state !== 'CONFIRMED') {
        this.logger.info(
          {
            orderId,
            provider: 'itrx',
            externalStatus: callback.status,
            externalType: callback.type,
            currentStatus: order.status,
          },
          'El estado externo de iTRX no confirma energia todavia',
        );
        return order;
      }

      if (order.status !== 'ENERGY_CONFIRMED') {
        this.logger.info(
          {
            orderId,
            provider: 'itrx',
            currentStatus: order.status,
            nextStatus: 'ENERGY_CONFIRMED',
          },
          'Aplicando transicion interna por confirmacion de energia',
        );
        const updatedOrder = await this.ordersService.transitionOrder(order, 'ENERGY_CONFIRMED', {
          actor,
          reason:
            order.type === 'BUY'
              ? 'Callback firmado de iTRX confirmó la energía para la wallet emisora BUY.'
              : 'Callback firmado de iTRX confirmó la energía para la deposit address.',
          metadata: {
            serial: callback.serial,
            txid: callback.txid,
            energyAmount: callback.energyAmount,
            payAmount: callback.payAmount,
            receiveAddress: callback.receiveAddress,
          },
        });

        this.logger.info(
          {
            orderId,
            provider: 'itrx',
            providerSerial: callback.serial,
            txid: callback.txid,
            energyAmount: callback.energyAmount,
            payAmount: callback.payAmount,
            requestKind: energyRequest ? this.inferRequestKind(energyRequest) : null,
          },
          order.type === 'BUY' ? 'itrx_buy_one_off_confirmed' : 'itrx_sell_collection_confirmed',
        );

        await this.outboxService.enqueueUnique({
          jobType: order.type === 'BUY' ? JOB_TYPES.SEND_BUY : JOB_TYPES.REQUEST_FORWARD,
          orderId,
          maxAttempts:
            order.type === 'BUY'
              ? this.config.buy.maxRetryCount
              : this.config.forward.maxRetryCount,
        });

        return updatedOrder;
      }

      return order;
    } finally {
      await this.lockService.releaseLease(lockLease);
    }
  }

  public async reconcilePendingEnergy(orderId: string, actor: ActorContext) {
    const order = await this.ordersService.getOrderOrFail(orderId);
    if (order.status !== 'ENERGY_REQUESTED') {
      return order;
    }

    const energyRequest = await this.energyRequestRepository.findLatestByOrderId(orderId);
    if (!energyRequest) {
      return order;
    }

    const requestKind = this.inferRequestKind(energyRequest);

    if (requestKind === 'AVAILABLE_BALANCE') {
      return order;
    }

    if (requestKind === 'COLLECTION' || requestKind === 'ONE_OFF') {
      let response;
      try {
        response = await this.itrxService.queryOrder({
          serial: energyRequest.providerSerial,
          outTradeNo: orderId,
        });
      } catch (error) {
        if (error instanceof ItrxTimeoutError) {
          this.logger.warn(
            {
              orderId,
              provider: 'itrx',
              receiveAddress: energyRequest.receiveAddress,
              energyContext: energyRequest.energyContext,
            },
            requestKind === 'COLLECTION' ? 'itrx_collection_query_timeout' : 'itrx_one_off_query_timeout',
          );
          return order;
        }

        if (error instanceof ItrxBadResponseError) {
          const details =
            typeof error.details === 'object' && error.details !== null
              ? (error.details as Record<string, unknown>)
              : null;
          const kind = typeof details?.['kind'] === 'string' ? details['kind'] : null;
          const raw =
            typeof details?.['raw'] === 'object' && details['raw'] !== null
              ? (details['raw'] as Record<string, unknown>)
              : null;

          if (energyRequest.id && raw) {
            await this.energyRequestRepository.updateById(energyRequest.id, {
              providerResponseRaw: raw,
            });
          }

          this.logger.warn(
            {
              orderId,
              provider: 'itrx',
              receiveAddress: energyRequest.receiveAddress,
              energyContext: energyRequest.energyContext,
              requestKind,
              errno: typeof details?.['errno'] === 'number' ? details['errno'] : null,
              kind,
            },
            kind === 'NON_SUCCESS_ERRNO'
              ? 'itrx_collection_non_success_errno'
              : 'itrx_collection_malformed_response',
          );
          return order;
        }

        throw error;
      }

      if (energyRequest.id) {
        await this.energyRequestRepository.updateById(energyRequest.id, {
          providerSerial: response.serial ?? energyRequest.providerSerial,
          providerResponseRaw: response.raw,
        });
      }

      this.logger.info(
        {
          orderId,
          provider: 'itrx',
          correlationField: response.serial ? 'serial' : 'out_trade_no',
          receiveAddress: energyRequest.receiveAddress,
          energyContext: energyRequest.energyContext,
          requestKind,
          externalStatus: response.status,
          serial: response.serial ?? energyRequest.providerSerial,
        },
        requestKind === 'COLLECTION' ? 'itrx_collection_reconcile_pending' : 'itrx_one_off_reconcile_pending',
      );

      if (response.status === 40) {
        this.logger.info(
          {
            orderId,
            provider: 'itrx',
            receiveAddress: energyRequest.receiveAddress,
            energyContext: energyRequest.energyContext,
            requestKind,
            serial: response.serial ?? energyRequest.providerSerial,
            externalStatus: response.status,
          },
          requestKind === 'COLLECTION'
            ? 'itrx_collection_reconcile_confirmed'
            : 'itrx_buy_one_off_confirmed',
        );
      }

      return this.handleConfirmedCallback(
        orderId,
        {
          energyAmount: response.energyAmount,
          payAmount: response.payAmount,
          serial: response.serial ?? energyRequest.providerSerial,
          txid: null,
          status: response.status,
          type: 'collection_query',
          receiveAddress: response.receiveAddress ?? energyRequest.receiveAddress,
          outTradeNo: response.outTradeNo ?? orderId,
          rawPayload: response.raw,
        },
        actor,
      );
    }

    if (requestKind !== 'SMART_DELEGATE') {
      return order;
    }

    let response;
    try {
      response = await this.itrxService.querySmartDelegatePolicy({
        receiveAddress: energyRequest.receiveAddress,
      });
    } catch (error) {
      if (error instanceof ItrxTimeoutError) {
        this.logger.warn(
          {
            orderId,
            provider: 'itrx',
            receiveAddress: energyRequest.receiveAddress,
            energyContext: energyRequest.energyContext,
          },
          'itrx_smart_delegate_query_timeout',
        );
        return order;
      }

      if (error instanceof ItrxBadResponseError) {
        const details =
          typeof error.details === 'object' && error.details !== null
            ? (error.details as Record<string, unknown>)
            : null;
        const kind = typeof details?.['kind'] === 'string' ? details['kind'] : null;
        const raw =
          typeof details?.['raw'] === 'object' && details['raw'] !== null
            ? (details['raw'] as Record<string, unknown>)
            : null;

        if (energyRequest.id && raw) {
          await this.energyRequestRepository.updateById(energyRequest.id, {
            providerResponseRaw: raw,
          });
        }

        this.logger.warn(
          {
            orderId,
            provider: 'itrx',
            receiveAddress: energyRequest.receiveAddress,
            energyContext: energyRequest.energyContext,
            code: typeof details?.['code'] === 'number' ? details['code'] : null,
            kind,
          },
          kind === 'NON_SUCCESS_CODE'
            ? 'itrx_smart_delegate_non_success_code'
            : 'itrx_smart_delegate_malformed_response',
        );
        return order;
      }

      throw error;
    }

    const matchedPolicy =
      response.results.find((item) => item.receiveAddress === energyRequest.receiveAddress) ?? null;

    if (energyRequest.id) {
      await this.energyRequestRepository.updateById(energyRequest.id, {
        providerResponseRaw: response.raw,
      });
    }

    if (!matchedPolicy) {
      this.logger.info(
        {
          orderId,
          provider: 'itrx',
          receiveAddress: energyRequest.receiveAddress,
          energyContext: energyRequest.energyContext,
        },
        'itrx_smart_delegate_not_found',
      );
      return order;
    }

    this.logger.info(
      {
        orderId,
        provider: 'itrx',
        correlationField: 'receive_address',
        receiveAddress: energyRequest.receiveAddress,
        energyContext: energyRequest.energyContext,
        externalStatus: matchedPolicy.status,
      },
      'Consulta de reconciliacion a iTRX ejecutada',
    );

    this.logger.info(
      {
        orderId,
        provider: 'itrx',
        receiveAddress: energyRequest.receiveAddress,
        energyContext: energyRequest.energyContext,
        externalStatus: matchedPolicy.status,
      },
      'itrx_query_recovered_state',
    );

    const mappedStatus =
      matchedPolicy.status === 1 ? 40 : [2, 10, 20].includes(matchedPolicy.status ?? -1) ? 41 : 30;

    return this.handleConfirmedCallback(
      orderId,
      {
        energyAmount: matchedPolicy.maxEnergy,
        payAmount: null,
        serial: energyRequest.providerSerial,
        txid: null,
        status: mappedStatus,
        type: 'smart_delegate_query',
        receiveAddress: matchedPolicy.receiveAddress,
        outTradeNo: orderId,
        rawPayload: response.raw,
      },
      actor,
    );
  }

  private async requestEnergyForOrder(
    orderId: string,
    expectedType: Order['type'],
    actor: ActorContext,
    executionContext?: FinancialJobExecutionContext,
  ) {
    const lockLease = await this.lockService.acquireLease(`order:${orderId}`);
    if (!lockLease) {
      throw new AppError({
        code: 'LOCK_NOT_ACQUIRED',
        statusCode: 409,
        message: 'No fue posible adquirir el lock de la orden para solicitar energía.',
      });
    }

    try {
      const order = await this.ordersService.getOrderOrFail(orderId);
      if (order.type !== expectedType) {
        throw new AppError({
          code: 'INVALID_STATE_TRANSITION',
          statusCode: 409,
          message: `La orden no corresponde a un flujo ${expectedType}.`,
        });
      }

      if (order.manualReviewRequired) {
        throw new AppError({
          code: 'MANUAL_REVIEW_REQUIRED',
          statusCode: 422,
          message: 'La orden no puede solicitar energía porque quedó en revisión manual.',
        });
      }

      if (order.status === 'ERROR_MANUAL_REVIEW') {
        throw new AppError({
          code: 'MANUAL_REVIEW_REQUIRED',
          statusCode: 422,
          message: 'La orden no puede solicitar energia porque esta en revision manual.',
        });
      }

      const context = this.buildContext(order);

      if (order.type === 'SELL' && order.cryptoAmountReceived === null) {
        throw new AppError({
          code: 'MANUAL_REVIEW_REQUIRED',
          statusCode: 422,
          message:
            'La orden SELL no puede solicitar energía porque no tiene un monto depositado confirmado.',
        });
      }

      if (order.type === 'BUY' && (order.cryptoAmountToSend === null || order.cryptoAmountToSend < this.config.orders.minOperationalUsdtBuy)) {
        const manualReviewOrder = await this.ordersService.markManualReview(
          order.orderId,
          actor,
          'La orden BUY no cumple el mínimo operativo requerido para solicitar energía.',
          {
            cryptoAmountToSend: order.cryptoAmountToSend,
            minOperationalUsdtBuy: this.config.orders.minOperationalUsdtBuy,
          },
        );

        throw new AppError({
          code: 'MANUAL_REVIEW_REQUIRED',
          statusCode: 422,
          message: manualReviewOrder.statusReason ?? 'La orden BUY requiere revisión manual.',
        });
      }

      const activeEnergyRequest = await this.energyRequestRepository.findActiveByOrderId(orderId);
      if (activeEnergyRequest) {
        return {
          order,
          energyRequest: activeEnergyRequest,
          skipped: true,
        };
      }

      if (order.status === 'ENERGY_CONFIRMED') {
        return {
          order,
          energyRequest: await this.energyRequestRepository.findLatestByOrderId(orderId),
          skipped: true,
        };
      }

      if (!(context.allowedStatuses as readonly Order['status'][]).includes(order.status)) {
        throw new AppError({
          code: 'INVALID_STATE_TRANSITION',
          statusCode: 409,
          message: 'La orden no está lista para solicitar energía.',
          details: {
            status: order.status,
            type: order.type,
          },
        });
      }

      if (order.type === 'BUY' && order.status === 'CREATED') {
        await this.ordersService.transitionOrder(order, 'VALIDATED', {
          actor,
          reason: 'Orden BUY validada y lista para preparar energía del sender.',
          metadata: {
            customerDestinationAddress: order.customerDestinationAddress,
            buySenderAddress: order.buySenderAddress,
          },
        });
      }

      if (context.reuseConfirmedEnergy) {
        const reusableRequest = await this.energyRequestRepository.findReusableConfirmedByAddress(
          context.receiveAddress,
          context.energyContext,
          new Date(
            Date.now() - this.config.energy.smartDelegateDays * 24 * 60 * 60 * 1_000,
          ),
        );

        if (reusableRequest) {
          const updatedOrder = await this.ordersService.transitionOrder(
            orderId,
            'ENERGY_CONFIRMED',
            {
              actor,
              reason:
                'Se reutilizó una confirmación vigente de energía para la wallet emisora BUY.',
              metadata: {
                reusedEnergyRequestId: reusableRequest.id,
                receiveAddress: reusableRequest.receiveAddress,
              },
            },
          );

          await this.outboxService.enqueueUnique({
            jobType: JOB_TYPES.SEND_BUY,
            orderId,
            maxAttempts: this.config.buy.maxRetryCount,
          });

          return {
            order: updatedOrder,
            energyRequest: reusableRequest,
            skipped: true,
          };
        }
      }

      let estimatedEnergyAmount: number | null = null;
      let currentOrder = order;

      if (context.selection.mode === 'estimated') {
        if (
          currentOrder.status !== 'ENERGY_ESTIMATION_REQUESTED' &&
          currentOrder.status !== 'ENERGY_ESTIMATED'
        ) {
          currentOrder = await this.ordersService.transitionOrder(orderId, 'ENERGY_ESTIMATION_REQUESTED', {
            actor,
            reason:
              currentOrder.type === 'BUY'
                ? 'Inicio de estimación de energía para envío BUY desde la hot wallet.'
                : 'Inicio de estimación de energía para transferencia TRC20.',
          });
        }

        this.logger.info(
          {
            orderId,
            provider: 'itrx',
            receiveAddress: context.receiveAddress,
            toAddress: context.estimateToAddress,
            energyContext: context.energyContext,
          },
          'itrx_estimate_requested',
        );

        try {
          if (executionContext) {
            await this.externalEffectGuard?.assertExternalEffectStillAllowed(executionContext, {
              operationType: 'ENERGY',
              allowedOrderStatuses: [
                'ENERGY_ESTIMATION_REQUESTED',
                'ENERGY_ESTIMATED',
                'ERROR_RETRYABLE',
              ],
            });
          }
          await this.ordersService.assertExternalEffectsAllowed(orderId, [
            'ENERGY_ESTIMATION_REQUESTED',
            'ENERGY_ESTIMATED',
            'ERROR_RETRYABLE',
          ]);
          const estimate = await this.itrxService.estimateEnergyForUsdtTransfer({
            toAddress: context.estimateToAddress,
          });
          estimatedEnergyAmount = estimate.energyAmount;

          this.logger.info(
            {
              orderId,
              provider: 'itrx',
              estimatedEnergyAmount,
              totalPriceSun: estimate.totalPriceSun,
              period: estimate.period,
            },
            'itrx_estimate_succeeded',
          );

          currentOrder = await this.ordersService.transitionOrder(orderId, 'ENERGY_ESTIMATED', {
            actor,
            reason: 'Estimación de energía recibida desde iTRX.',
            patch: {
              energyEstimatedAt: new Date(),
            },
            metadata: {
              estimatedEnergyAmount,
              totalPriceSun: estimate.totalPriceSun,
              period: estimate.period,
              receiveAddress: context.receiveAddress,
            },
          });
        } catch (error) {
          if (!(error instanceof ItrxTimeoutError) && !(error instanceof ItrxBadResponseError)) {
            throw error;
          }

          this.logger.warn(
            {
              orderId,
              provider: 'itrx',
              errorName: error.name,
              allowFixedFallback: context.selection.allowFixedFallback,
            },
            'itrx_estimate_failed',
          );

          if (!context.selection.allowFixedFallback) {
            await this.ordersService.transitionOrder(orderId, 'ERROR_RETRYABLE', {
              actor,
              reason:
                'Falló la estimación de energía y no existe fallback fijo habilitado.',
              errorCode:
                error instanceof ItrxTimeoutError ? 'PROVIDER_TIMEOUT' : 'PROVIDER_BAD_RESPONSE',
              errorMessage: error.message,
            });

            throw new AppError({
              code:
                error instanceof ItrxTimeoutError ? 'PROVIDER_TIMEOUT' : 'PROVIDER_BAD_RESPONSE',
              statusCode: error instanceof ItrxTimeoutError ? 503 : 502,
              message:
                error instanceof ItrxTimeoutError
                  ? 'iTRX no respondiÃ³ a tiempo durante la estimaciÃ³n de energÃ­a.'
                  : 'iTRX devolviÃ³ una respuesta invÃ¡lida durante la estimaciÃ³n de energÃ­a.',
              details: error instanceof ItrxBadResponseError ? error.details : undefined,
            });
          }

          this.logger.info(
            {
              orderId,
              provider: 'itrx',
              fixedAmount: context.selection.fixedAmount,
            },
            'itrx_fixed_fallback_used',
          );
        }
      }

      const selection = selectEnergyRequestAmount({
        mode: context.selection.mode,
        estimatedEnergyAmount,
        fixedAmount: context.selection.fixedAmount,
        safetyMultiplier: context.selection.safetyMultiplier,
        minFloor: context.selection.minFloor,
        maxCap: context.selection.maxCap,
        allowFixedFallback: context.selection.allowFixedFallback,
      });
      let requestedEnergyAmount = selection.requestedEnergyAmount;
      let availableEnergy: number | null = null;

      if (order.type === 'BUY') {
        let resources;
        try {
          resources = await this.tronService.getAccountResources(context.receiveAddress);
        } catch (error) {
          await this.ordersService.transitionOrder(orderId, 'ERROR_RETRYABLE', {
            actor,
            reason:
              'No fue posible consultar los recursos actuales de la wallet BUY antes de comprar energia.',
            errorCode: 'PROVIDER_BAD_RESPONSE',
            errorMessage: error instanceof Error ? error.message : 'unknown_error',
          });

          throw new AppError({
            code: 'PROVIDER_BAD_RESPONSE',
            statusCode: 503,
            message: 'No fue posible consultar los recursos actuales de la wallet BUY.',
          });
        }

        availableEnergy = resources.availableEnergy;
        const rawDeficit = Math.max(0, selection.requestedEnergyAmount - availableEnergy);
        requestedEnergyAmount =
          rawDeficit > 0 && this.config.energyBuy.providerMinOrder > 0
            ? Math.min(
                Math.max(rawDeficit, this.config.energyBuy.providerMinOrder),
                this.config.energyBuy.maxCap,
              )
            : rawDeficit;

        this.logger.info(
          {
            orderId,
            provider: 'trongrid',
            receiveAddress: this.maskAddress(context.receiveAddress),
            estimatedEnergy: selection.estimatedEnergyAmount,
            availableEnergy,
            requestedEnergy: requestedEnergyAmount,
            energyLimit: resources.energyLimit,
            energyUsed: resources.energyUsed,
          },
          'itrx_buy_resources_checked',
        );

        if (requestedEnergyAmount === 0) {
          await this.ordersService.transitionOrder(orderId, 'ENERGY_REQUESTED', {
            actor,
            reason: 'Energy suficiente disponible en la wallet BUY; no se crea orden iTRX.',
            metadata: {
              modeUsed: selection.modeUsed,
              estimatedEnergyAmount: selection.estimatedEnergyAmount,
              requestedEnergyAmount,
              availableEnergy,
              receiveAddress: context.receiveAddress,
              energyContext: context.energyContext,
              requestKind: 'AVAILABLE_BALANCE',
            },
          });

          const createdRequest = await this.energyRequestRepository.create({
            orderId,
            provider: 'itrx',
            mode: selection.modeUsed,
            energyContext: context.energyContext,
            requestKind: 'AVAILABLE_BALANCE',
            estimatedEnergyAmount: selection.estimatedEnergyAmount,
            requestedEnergyAmount,
            safetyMultiplier: context.selection.safetyMultiplier,
            period: this.config.energyBuy.oneOffPeriod,
            receiveAddress: context.receiveAddress,
            callbackUrl: null,
            providerRequestRaw: null,
            providerResponseRaw: {
              source: 'tron_getaccountresource',
              availableEnergy,
              energyLimit: resources.energyLimit,
              energyUsed: resources.energyUsed,
            },
            providerSerial: null,
            status: 'CONFIRMED',
            signatureValid: null,
            confirmedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const updatedOrder = await this.ordersService.transitionOrder(orderId, 'ENERGY_CONFIRMED', {
            actor,
            reason: 'Energy suficiente confirmada on-chain para la wallet BUY.',
            metadata: {
              energyRequestId: createdRequest.id,
              requestedEnergyAmount,
              availableEnergy,
              requestKind: 'AVAILABLE_BALANCE',
            },
          });

          this.logger.info(
            {
              orderId,
              energyRequestId: createdRequest.id,
              requestKind: 'AVAILABLE_BALANCE',
              estimatedEnergy: selection.estimatedEnergyAmount,
              availableEnergy,
              requestedEnergy: requestedEnergyAmount,
              receiveAddress: this.maskAddress(context.receiveAddress),
            },
            'itrx_buy_one_off_skipped_available',
          );

          await this.outboxService.enqueueUnique({
            jobType: JOB_TYPES.SEND_BUY,
            orderId,
            maxAttempts: this.config.buy.maxRetryCount,
          });

          return {
            order: updatedOrder,
            energyRequest: createdRequest,
            skipped: false,
          };
        }
      }

      this.logger.info(
        {
          orderId,
          provider: 'itrx',
          modeUsed: selection.modeUsed,
          usedFallback: selection.usedFallback,
          requestedEnergyAmount,
          receiveAddress: this.maskAddress(context.receiveAddress),
          energyContext: context.energyContext,
          requestKind: context.requestKind,
          estimatedEnergy: selection.estimatedEnergyAmount,
          availableEnergy,
        },
        context.requestKind === 'COLLECTION' ? 'itrx_sell_collection_requested' : 'itrx_buy_one_off_requested',
      );

      await this.ordersService.transitionOrder(orderId, 'ENERGY_REQUESTED', {
        actor,
        reason: 'Solicitud de energía enviada a iTRX.',
        metadata: {
          modeUsed: selection.modeUsed,
          estimatedEnergyAmount: selection.estimatedEnergyAmount,
          requestedEnergyAmount,
          usedFallback: selection.usedFallback,
          availableEnergy,
          receiveAddress: context.receiveAddress,
          energyContext: context.energyContext,
          requestKind: context.requestKind,
        },
      });

      const createdRequest = await this.energyRequestRepository.create({
        orderId,
        provider: 'itrx',
        mode: selection.modeUsed,
        energyContext: context.energyContext,
        requestKind: context.requestKind,
        estimatedEnergyAmount: selection.estimatedEnergyAmount,
        requestedEnergyAmount,
        safetyMultiplier: context.selection.safetyMultiplier,
        period:
          context.requestKind === 'ONE_OFF'
            ? this.config.energyBuy.oneOffPeriod
            : context.selection.mode === 'estimated'
              ? this.config.energy.rentalPeriod
              : this.config.energy.smartDelegateDays,
        receiveAddress: context.receiveAddress,
        callbackUrl: `${this.config.apiBaseUrl}/api/v1/webhooks/itrx`,
        providerRequestRaw: null,
        providerResponseRaw: null,
        providerSerial: null,
        status: 'PENDING',
        signatureValid: null,
        confirmedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      try {
        if (executionContext) {
          await this.externalEffectGuard?.assertExternalEffectStillAllowed(executionContext, {
            operationType: 'ENERGY',
            allowedOrderStatuses: ['ENERGY_REQUESTED'],
            allowedRequestId: createdRequest.id ?? null,
          });
        }
        await this.ordersService.assertExternalEffectsAllowed(orderId, ['ENERGY_REQUESTED']);
        const response =
          context.requestKind === 'COLLECTION'
            ? await this.itrxService.createCollectionOrder({
                receiveAddress: context.receiveAddress,
                toAddress: context.toAddress,
                outTradeNo: order.orderId,
              })
            : await this.itrxService.createOneOffEnergyOrder({
                receiveAddress: context.receiveAddress,
                energyAmount: requestedEnergyAmount,
                outTradeNo: order.orderId,
              });

        const updatedRequest = await this.energyRequestRepository.updateById(
          createdRequest.id as string,
          {
            providerRequestRaw: response.requestBody as unknown as Record<string, unknown>,
            providerResponseRaw: response.response.raw,
            providerSerial: 'serial' in response.response ? response.response.serial : null,
            status: response.response.errno === 0 ? 'REQUESTED' : 'FAILED',
          },
        );

        if (context.requestKind === 'COLLECTION') {
          this.logger.info(
            {
              orderId,
              provider: 'itrx',
              receiveAddress: this.maskAddress(context.receiveAddress),
              toAddress: this.maskAddress(context.toAddress),
              energyContext: context.energyContext,
              requestKind: context.requestKind,
              serial: 'serial' in response.response ? response.response.serial : null,
              errno: response.response.errno,
              responseData: response.response.raw,
            },
            'itrx_collection_succeeded',
          );
        }

        if (context.requestKind === 'ONE_OFF') {
          this.logger.info(
            {
              orderId,
              energyRequestId: updatedRequest?.id ?? createdRequest.id,
              provider: 'itrx',
              receiveAddress: this.maskAddress(context.receiveAddress),
              energyContext: context.energyContext,
              requestKind: context.requestKind,
              providerSerial: 'serial' in response.response ? response.response.serial : null,
              estimatedEnergy: selection.estimatedEnergyAmount,
              availableEnergy,
              requestedEnergy: requestedEnergyAmount,
            },
            'itrx_buy_one_off_requested',
          );
        }

        if (response.response.errno !== 0) {
          throw new ItrxBadResponseError(
            'iTRX rechazó la creación de la política de energía.',
            response.response.raw,
          );
        }

        return {
          order: await this.ordersService.getOrderOrFail(orderId),
          energyRequest: updatedRequest,
          skipped: false,
        };
      } catch (error) {
        await this.energyRequestRepository.updateById(createdRequest.id as string, {
          status: isOutcomeUnknownError(error, 'energy_request') ? 'OUTCOME_UNKNOWN' : 'FAILED',
          providerResponseRaw:
            error instanceof Error
              ? {
                  errorName: error.name,
                  errorMessage: error.message,
                  outcomeUncertain: isOutcomeUnknownError(error, 'energy_request'),
                }
              : undefined,
        });

        if (isOutcomeUnknownError(error, 'energy_request')) {
          await this.ordersService.markManualReview(
            orderId,
            actor,
            'Error ambiguo al solicitar energia en iTRX; el resultado es incierto y requiere revision manual.',
            {
              outcomeUncertain: true,
              lastErrorCode: error instanceof ItrxTimeoutError ? 'PROVIDER_TIMEOUT' : 'PROVIDER_BAD_RESPONSE',
              lastErrorMessage: error instanceof Error ? error.message : 'unknown_error',
              lastAttemptAt: new Date().toISOString(),
              provider: 'itrx',
              operationType: 'energy',
            },
          );

          throw new AppError({
            code: 'PROVIDER_TIMEOUT',
            statusCode: 503,
            message: 'iTRX tuvo un resultado ambiguo al solicitar energia.',
          });

        }

        if (error instanceof ItrxBadResponseError) {
          if (context.requestKind === 'COLLECTION') {
            this.logger.warn(
              {
                orderId,
                provider: 'itrx',
                receiveAddress: context.receiveAddress,
                toAddress: context.toAddress,
                energyContext: context.energyContext,
                err: error.details,
              },
              'itrx_collection_failed',
            );
          }
          await this.ordersService.transitionOrder(orderId, 'ERROR_RETRYABLE', {
            actor,
            reason: 'iTRX respondió con error al solicitar energía.',
            errorCode: 'ENERGY_REQUEST_FAILED',
            errorMessage: error.message,
          });

          throw new AppError({
            code: 'ENERGY_REQUEST_FAILED',
            statusCode: 502,
            message: 'iTRX no aceptó la solicitud de energía.',
            details: error.details,
          });
        }

        throw error;
      }
    } finally {
      await this.lockService.releaseLease(lockLease);
    }
  }

  private buildContext(order: Order) {
    if (order.type === 'BUY') {
      if (!order.buySenderAddress || !order.customerDestinationAddress) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'La orden BUY no tiene configuradas las direcciones requeridas.',
        });
      }

      return {
        allowedStatuses: BUY_ALLOWED_STATUSES,
        energyContext: 'BUY_SENDER' as const,
        requestKind: 'ONE_OFF' as const,
        receiveAddress: order.buySenderAddress,
        estimateToAddress: order.customerDestinationAddress,
        toAddress: order.customerDestinationAddress,
        reuseConfirmedEnergy: false,
        selection: this.config.energyBuy,
      };
    }

    if (!order.depositAddress) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        message: 'La orden SELL no tiene una deposit address configurada.',
      });
    }

    return {
      allowedStatuses: SELL_ALLOWED_STATUSES,
      energyContext: 'SELL_DEPOSIT' as const,
      requestKind: 'COLLECTION' as const,
      receiveAddress: order.depositAddress,
      estimateToAddress: this.config.tron.forwardTargetAddress,
      toAddress: this.config.tron.forwardTargetAddress,
      reuseConfirmedEnergy: false,
      selection: this.config.energy,
    };
  }

  private maskAddress(address: string | null | undefined): string | null {
    if (!address) {
      return null;
    }

    if (address.length <= 10) {
      return address;
    }

    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}
