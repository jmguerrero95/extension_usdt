import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { MongoServerError } from 'mongodb';

import type { AppConfig } from '../../app/config/env';
import { AppError } from '../../app/errors/app-error';
import type { Order } from '../../domain/entities/order.entity';
import type { ProviderEvent } from '../../domain/entities/provider-event.entity';
import type { ProviderEventRepository } from '../../domain/repositories/provider-event.repository';
import { validateDepositForOrder, type NormalizedDepositEvent } from '../../domain/services/deposit-validation.service';
import type { CryptoCurrencyApiService } from '../../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.service';
import type { ItrxService } from '../../infrastructure/providers/itrx/itrx.service';
import type { TronService } from '../../infrastructure/blockchain/tron.service';
import type { OutboxService } from '../../infrastructure/queue/outbox.service';
import { JOB_TYPES } from '../../shared/constants/job-types';
import type { ActorContext } from '../../shared/types/actor';
import type { EnergyService } from '../energy/energy.service';
import type { ForwardsService } from '../forwards/forwards.service';
import type { OrdersService } from '../orders/orders.service';

const buildHeadersRecord = (
  headers: FastifyRequest['headers'],
): Record<string, string | string[] | undefined> =>
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, value]));

const isDuplicateKeyError = (error: unknown): boolean =>
  error instanceof MongoServerError && error.code === 11000;

const isIpAllowed = (requestIp: string, allowlist: string[]): boolean =>
  allowlist.length === 0 || allowlist.includes(requestIp);

const ORDER_ID_PATTERN = /(ord_[0-9a-z]+)/i;

const extractOrderIdFromUniqId = (uniqID: string | null): string | null =>
  uniqID?.match(ORDER_ID_PATTERN)?.[1]?.toLowerCase() ?? null;

const extractOrderIdFromLabel = (label: string | null): string | null => {
  if (!label) {
    return null;
  }

  const directMatch = label.match(/^(?:send|forward)\|(ord_[0-9a-z]+)$/i);
  if (directMatch?.[1]) {
    return directMatch[1].toLowerCase();
  }

  const trailingMatch = label.match(/(?:^|\|)(ord_[0-9a-z]+)$/i);
  return trailingMatch?.[1]?.toLowerCase() ?? null;
};

export class ProviderEventsService {
  public constructor(
    private readonly config: AppConfig,
    private readonly providerEventRepository: ProviderEventRepository,
    private readonly ordersService: OrdersService,
    private readonly energyService: EnergyService,
    private readonly forwardsService: ForwardsService,
    private readonly cryptoCurrencyApiService: CryptoCurrencyApiService,
    private readonly itrxService: ItrxService,
    private readonly tronService: TronService,
    private readonly outboxService: OutboxService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  private getCryptoCorrelationReason(
    order: Order,
    normalized: {
      eventType: string;
      address: string | null;
      label: string | null;
      uniqID: string | null;
      requestId: string | null;
    },
  ): string | null {
    const orderIdFromUniqId = extractOrderIdFromUniqId(normalized.uniqID);
    const orderIdFromLabel = extractOrderIdFromLabel(normalized.label);

    if (orderIdFromUniqId && orderIdFromUniqId !== order.orderId) {
      return 'uniqID apunta a una orden distinta.';
    }

    if (orderIdFromLabel && orderIdFromLabel !== order.orderId) {
      return 'label apunta a una orden distinta.';
    }

    if (normalized.eventType === 'deposit') {
      if (order.type !== 'SELL') {
        return 'Un deposito solo puede correlacionarse con una orden SELL.';
      }

      if (normalized.address && order.depositAddress !== normalized.address) {
        return 'La deposit address no coincide con la orden correlacionada.';
      }

      if (normalized.uniqID && order.providerUniqId !== normalized.uniqID) {
        return 'El uniqID del deposito no coincide con la orden correlacionada.';
      }

      if (normalized.label && order.providerLabel !== normalized.label) {
        return 'El label del deposito no coincide con la orden correlacionada.';
      }
    }

    if (normalized.eventType === 'forward') {
      if (order.type !== 'SELL') {
        return 'Un evento forward no puede correlacionarse con una orden BUY.';
      }

      if (
        normalized.uniqID &&
        ![order.providerUniqId, `forward_${order.orderId}`].includes(normalized.uniqID)
      ) {
        return 'El uniqID del forward no coincide con la orden correlacionada.';
      }

      if (
        normalized.label &&
        ![order.providerLabel, `forward|${order.orderId}`].includes(normalized.label)
      ) {
        return 'El label del forward no coincide con la orden correlacionada.';
      }
    }

    if (normalized.eventType === 'send') {
      if (order.type !== 'BUY') {
        return 'Un evento send no puede correlacionarse con una orden SELL.';
      }

      if (
        normalized.uniqID &&
        ![order.providerUniqId, `send_${order.orderId}`].includes(normalized.uniqID)
      ) {
        return 'El uniqID del send no coincide con la orden correlacionada.';
      }

      if (
        normalized.label &&
        ![order.providerLabel, `send|${order.orderId}`].includes(normalized.label)
      ) {
        return 'El label del send no coincide con la orden correlacionada.';
      }
    }

    const knownRequestIds = [
      order.providerForwardRequestId,
      order.providerSendRequestId,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (
      normalized.requestId &&
      knownRequestIds.length > 0 &&
      !knownRequestIds.includes(normalized.requestId)
    ) {
      return 'El providerRequestId no coincide con la orden correlacionada.';
    }

    return null;
  }

  private getItrxCorrelationReason(
    order: Order,
    normalized: {
      outTradeNo: string | null;
      receiveAddress: string | null;
    },
  ): string | null {
    if (normalized.outTradeNo && normalized.outTradeNo !== order.orderId) {
      return 'El out_trade_no apunta a una orden distinta.';
    }

    const expectedAddress =
      order.type === 'BUY' ? order.buySenderAddress : order.depositAddress;

    if (normalized.receiveAddress && expectedAddress && normalized.receiveAddress !== expectedAddress) {
      return 'La receive_address no coincide con la orden correlacionada.';
    }

    return null;
  }

  private async correlateCryptoCurrencyApiOrder(normalized: {
    eventType: string;
    address: string | null;
    label: string | null;
    uniqID: string | null;
    requestId: string | null;
  }): Promise<{ order: Order | null; matchedBy: string | null; reason: string | null }> {
    const orderIdFromUniqId = extractOrderIdFromUniqId(normalized.uniqID);
    const orderIdFromLabel = extractOrderIdFromLabel(normalized.label);

    const attempts: Array<{ matchedBy: string; order: Order | null }> = [];

    if (normalized.requestId) {
      attempts.push({
        matchedBy: 'providerRequestId',
        order: await this.ordersService.findByCorrelation({
          providerRequestId: normalized.requestId,
        }),
      });
    }

    if (orderIdFromUniqId) {
      attempts.push({
        matchedBy: 'uniqID',
        order: await this.ordersService.getInternalOrder(orderIdFromUniqId).catch(() => null),
      });
    }

    if (!orderIdFromUniqId && orderIdFromLabel) {
      attempts.push({
        matchedBy: 'label',
        order: await this.ordersService.getInternalOrder(orderIdFromLabel).catch(() => null),
      });
    }

    if (normalized.eventType === 'deposit' && normalized.address) {
      const order = await this.ordersService.findByCorrelation({
        depositAddress: normalized.address,
      });

      attempts.push({
        matchedBy: 'depositAddress',
        order: order?.type === 'SELL' && order.depositAddress === normalized.address ? order : null,
      });
    }

    for (const attempt of attempts) {
      if (!attempt.order) {
        continue;
      }

      const reason = this.getCryptoCorrelationReason(attempt.order, normalized);
      if (!reason) {
        return {
          order: attempt.order,
          matchedBy: attempt.matchedBy,
          reason: null,
        };
      }

      return {
        order: null,
        matchedBy: attempt.matchedBy,
        reason,
      };
    }

    return {
      order: null,
      matchedBy: null,
      reason: 'El webhook no trae identificadores suficientes para correlacionar de forma segura.',
    };
  }

  private async correlateItrxOrder(normalized: {
    outTradeNo: string | null;
    receiveAddress: string | null;
  }): Promise<{ order: Order | null; matchedBy: string | null; reason: string | null }> {
    if (normalized.outTradeNo) {
      const order = await this.ordersService.getInternalOrder(normalized.outTradeNo).catch(() => null);
      if (!order) {
        return {
          order: null,
          matchedBy: 'outTradeNo',
          reason: 'No existe una orden con el out_trade_no recibido.',
        };
      }

      const reason = this.getItrxCorrelationReason(order, normalized);
      return {
        order: reason ? null : order,
        matchedBy: 'outTradeNo',
        reason,
      };
    }

    if (!normalized.receiveAddress) {
      return {
        order: null,
        matchedBy: null,
        reason: 'El callback iTRX no incluye out_trade_no ni receive_address.',
      };
    }

    if (normalized.receiveAddress === this.config.tron.buySenderAddress) {
      return {
        order: null,
        matchedBy: 'receiveAddress',
        reason:
          'No se permite correlacionar callbacks BUY solo por receive_address porque la hot wallet emisora es compartida.',
      };
    }

    const order = await this.ordersService.findByCorrelation({
      depositAddress: normalized.receiveAddress,
    });

    if (!order || order.type !== 'SELL' || order.depositAddress !== normalized.receiveAddress) {
      return {
        order: null,
        matchedBy: 'receiveAddress',
        reason: 'No existe una orden SELL unica y segura para la receive_address recibida.',
      };
    }

    return {
      order,
      matchedBy: 'receiveAddress',
      reason: null,
    };
  }

  private async processSellDepositEvent(
    order: Order,
    normalized: NormalizedDepositEvent,
    actor: ActorContext,
    metadataSource: string,
  ): Promise<Order> {
    const verifiedEvent = await this.verifySellDepositEvent(order, normalized, metadataSource);
    let workingOrder = order;

    if (
      verifiedEvent.txid &&
      verifiedEvent.amount !== null &&
      verifiedEvent.token?.toUpperCase() === 'USDT' &&
      verifiedEvent.network?.toUpperCase() === 'TRON'
    ) {
      const observation = await this.ordersService.recordSellDepositObservation(workingOrder, {
        txid: verifiedEvent.txid,
        amount: verifiedEvent.amount,
        confirmations: verifiedEvent.confirmations,
        source: 'webhook',
      });
      workingOrder = observation.order;

      if (observation.conflict) {
        return this.ordersService.markManualReview(
          workingOrder.orderId,
          actor,
          'Se detecto un conflicto en la identidad del deposito SELL observado.',
          {
            source: metadataSource,
            observedTxid: workingOrder.depositObservedTxid,
            incomingTxid: verifiedEvent.txid,
            amount: verifiedEvent.amount,
            confirmations: verifiedEvent.confirmations,
            conflictReason: observation.reason ?? null,
          },
        );
      }
    }

    const decision = validateDepositForOrder(workingOrder, verifiedEvent, {
      minConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
      minOperationalUsdt: this.config.orders.minOperationalUsdt,
      allowPartialDeposits: this.config.orders.allowPartialDeposits,
      tolerancePercent: this.config.orders.amountTolerancePercent,
    });

    if (decision.nextStatus === 'LATE_DEPOSIT') {
      return this.ordersService.transitionOrder(workingOrder, 'LATE_DEPOSIT', {
        actor,
        reason: decision.reason,
        patch: {
          cryptoAmountReceived: verifiedEvent.amount ?? decision.acceptedAmount,
          manualReviewRequired: true,
        },
        metadata: {
          txid: verifiedEvent.txid,
          amount: verifiedEvent.amount,
          confirmations: verifiedEvent.confirmations,
          source: metadataSource,
        },
        errorCode: 'LATE_DEPOSIT_DETECTED',
        errorMessage: decision.reason,
      });
    }

    if (decision.nextStatus === 'ERROR_MANUAL_REVIEW') {
      const manualReviewOrder = await this.ordersService.markManualReview(
        workingOrder.orderId,
        actor,
        decision.reason,
        {
          source: metadataSource,
          txid: verifiedEvent.txid,
          amount: verifiedEvent.amount,
          confirmations: verifiedEvent.confirmations,
        },
      );
      await this.ordersService.patchOrder(workingOrder.orderId, {
        cryptoAmountReceived: verifiedEvent.amount,
      });
      return this.ordersService.getOrderOrFail(manualReviewOrder.orderId);
    }

    if (decision.accepted && workingOrder.status === 'WAITING_DEPOSIT') {
      const updatedOrder = await this.ordersService.transitionOrder(workingOrder, 'DEPOSIT_DETECTED', {
        actor,
        reason: decision.reason,
        patch: {
          cryptoAmountReceived: decision.acceptedAmount,
        },
        metadata: {
          txid: verifiedEvent.txid,
          amount: verifiedEvent.amount,
          confirmations: verifiedEvent.confirmations,
          source: metadataSource,
        },
      });

      await this.outboxService.enqueueUnique({
        jobType: JOB_TYPES.REQUEST_ENERGY,
        orderId: workingOrder.orderId,
        maxAttempts: this.config.energy.maxRetryCount,
      });

      return updatedOrder;
    }

    return workingOrder;
  }

  private async verifySellDepositEvent(
    order: Order,
    normalized: NormalizedDepositEvent,
    metadataSource: string,
  ): Promise<NormalizedDepositEvent> {
    const expectedAddress = this.tronService.normalizeAddress(order.depositAddress);
    const payloadAddress = this.tronService.normalizeAddress(normalized.address);

    if (payloadAddress) {
      if (payloadAddress !== expectedAddress) {
        this.logger.warn(
          {
            orderId: order.orderId,
            txid: normalized.txid,
            internalStatus: order.status,
            casProjectedStatus: order.status,
            confirmations: normalized.confirmations,
            requiredConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
            source: metadataSource,
            expectedAddress,
            actualAddress: payloadAddress,
          },
          'cas_sell_deposit_address_mismatch',
        );
        throw new AppError({
          code: 'INVALID_STATE_TRANSITION',
          statusCode: 409,
          message: 'La direccion del deposito no coincide con la orden SELL correlacionada.',
        });
      }

      return {
        ...normalized,
        address: payloadAddress,
      };
    }

    if (!normalized.txid) {
      throw new AppError({
        code: 'PROVIDER_BAD_RESPONSE',
        statusCode: 502,
        message: 'El webhook no incluye una direccion verificable ni un txid utilizable.',
      });
    }

    const transfer = await this.tronService.getUSDTTransferByTxid(normalized.txid);
    const transferAddress = this.tronService.normalizeAddress(transfer?.to);

    if (!transfer || transferAddress !== expectedAddress) {
      this.logger.warn(
        {
          orderId: order.orderId,
          txid: normalized.txid,
          internalStatus: order.status,
          casProjectedStatus: order.status,
          confirmations: normalized.confirmations,
          requiredConfirmations: this.config.orders.minConfirmationsUsdtTrc20,
          source: metadataSource,
          expectedAddress,
          actualAddress: transferAddress,
        },
        'cas_sell_deposit_address_mismatch',
      );
      throw new AppError({
        code: 'PROVIDER_BAD_RESPONSE',
        statusCode: 502,
        message: 'No fue posible verificar on-chain la transferencia del deposito SELL.',
      });
    }

    if (
      normalized.amount !== null &&
      Number.isFinite(normalized.amount) &&
      normalized.amount !== transfer.amount
    ) {
      return {
        ...normalized,
        address: transferAddress,
        amount: transfer.amount,
        confirmations: transfer.confirmations,
        rawPayload: {
          ...normalized.rawPayload,
          verifiedOnChain: true,
          blockchainAmount: transfer.amount,
          blockchainTo: transfer.to,
        },
      };
    }

    return {
      ...normalized,
      address: transferAddress,
      amount: transfer.amount,
      confirmations: transfer.confirmations,
      rawPayload: {
        ...normalized.rawPayload,
        verifiedOnChain: true,
        blockchainAmount: transfer.amount,
        blockchainTo: transfer.to,
      },
    };
  }

  public async handleCryptoCurrencyApiWebhook(input: {
    payload: Record<string, unknown>;
    rawBody: string | null;
    request: FastifyRequest;
  }) {
    const logger = input.request.log;

    if (
      this.config.security.webhookRequireIpAllowlist &&
      !isIpAllowed(input.request.ip, this.config.providers.cryptocurrencyapi.ipAllowlist)
    ) {
      throw new AppError({
        code: 'FORBIDDEN',
        statusCode: 403,
        message: 'La IP del webhook no está autorizada para CryptoCurrencyAPI.',
      });
    }

    const normalized = this.cryptoCurrencyApiService.normalizeWebhookPayload(input.payload);
    const eventKey = this.cryptoCurrencyApiService.buildEventKey(input.rawBody, input.payload);
    const actor: ActorContext = {
      actorType: 'provider',
      actorId: `cryptocurrencyapi:${eventKey}`,
    };

    let event: ProviderEvent;
    try {
      event = await this.providerEventRepository.create({
        provider: 'cryptocurrencyapi',
        eventType: normalized.eventType,
        eventKey,
        orderId: null,
        headers: buildHeadersRecord(input.request.headers),
        payload: input.payload,
        rawBody: input.rawBody,
        signatureValid: null,
        processed: false,
        processedAt: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        logger.info(
          {
            provider: 'cryptocurrencyapi',
            eventKey,
          },
          'Webhook duplicado de CryptoCurrencyAPI ignorado por idempotencia',
        );
        return {
          duplicate: true,
          event: await this.providerEventRepository.findByEventKey(eventKey),
        };
      }

      throw error;
    }

    try {
      const correlation = await this.correlateCryptoCurrencyApiOrder(normalized);
      const order = correlation.order;

      if (!order) {
        logger.warn(
          {
            provider: 'cryptocurrencyapi',
            eventKey,
            requestId: normalized.requestId,
            uniqID: normalized.uniqID,
            label: normalized.label,
            address: normalized.address,
            txid: normalized.txid,
            matchedBy: correlation.matchedBy,
            reason: correlation.reason,
          },
          'Webhook de CryptoCurrencyAPI rechazado por correlacion insegura o insuficiente',
        );
        await this.providerEventRepository.markProcessed(eventKey, {
          processed: false,
          processedAt: new Date(),
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'No se encontró una orden correlacionada para el evento.',
          },
          orderId: null,
        });

        throw new AppError({
          code: 'ORDER_NOT_FOUND',
          statusCode: 404,
          message: 'No se pudo correlacionar el evento del proveedor con una orden.',
        });
      }

      logger.info(
        {
          provider: 'cryptocurrencyapi',
          eventKey,
          orderId: order.orderId,
          matchedBy: correlation.matchedBy,
          requestId: normalized.requestId,
          uniqID: normalized.uniqID,
          label: normalized.label,
          txid: normalized.txid,
          externalStatus: normalized.status,
        },
        'Webhook de CryptoCurrencyAPI correlacionado',
      );

      let resultingOrder = order;

      if (normalized.eventType === 'deposit' && order.type === 'SELL') {
        resultingOrder = await this.processSellDepositEvent(
          order,
          normalized as NormalizedDepositEvent,
          actor,
          'cryptocurrencyapi-webhook',
        );
      }

      if (order.type === 'SELL' && normalized.eventType === 'forward') {
        resultingOrder = await this.forwardsService.handleForwardWebhook(order.orderId, normalized, actor);
      }

      if (
        order.type === 'BUY' &&
        (normalized.eventType === 'send' || normalized.eventType === 'forward')
      ) {
        resultingOrder = await this.forwardsService.handleSendWebhook(order.orderId, normalized, actor);
      }

      logger.info(
        {
          provider: 'cryptocurrencyapi',
          eventKey,
          orderId: order.orderId,
          externalStatus: normalized.status,
          currentStatus: resultingOrder.status,
          txid: normalized.txid,
        },
        'Webhook de CryptoCurrencyAPI procesado',
      );

      await this.providerEventRepository.markProcessed(eventKey, {
        processed: true,
        processedAt: new Date(),
        error: null,
        orderId: order.orderId,
        purgeAt: this.buildSuccessfulEventPurgeAt(),
      });

      return {
        duplicate: false,
        event,
      };
    } catch (error) {
      await this.providerEventRepository.markProcessed(eventKey, {
        processed: false,
        processedAt: new Date(),
        error:
          error instanceof AppError
            ? {
                code: error.code,
                message: error.message,
                details: error.details,
              }
            : {
                code: 'INTERNAL_ERROR',
                message: 'Error no controlado procesando evento de CryptoCurrencyAPI.',
              },
        orderId: event.orderId,
      });

      throw error;
    }
  }

  public async handleItrxWebhook(input: {
    payload: Record<string, unknown>;
    rawBody: string | null;
    request: FastifyRequest;
  }) {
    const logger = input.request.log;

    if (
      this.config.security.webhookRequireIpAllowlist &&
      !isIpAllowed(input.request.ip, this.config.providers.itrx.ipAllowlist)
    ) {
      throw new AppError({
        code: 'FORBIDDEN',
        statusCode: 403,
        message: 'La IP del webhook no está autorizada para iTRX.',
      });
    }

    const normalized = this.itrxService.normalizeCallbackPayload(input.payload);
    const eventKey = this.itrxService.buildEventKey(input.rawBody, input.payload);
    const signatureValid = this.itrxService.verifyCallbackSignature(input.request.headers, input.payload);
    const timestampHeader = input.request.headers['timestamp'];
    const timestampFresh =
      typeof timestampHeader === 'string' && this.itrxService.isCallbackTimestampFresh(timestampHeader);

    let event: ProviderEvent;
    try {
      event = await this.providerEventRepository.create({
        provider: 'itrx',
        eventType: 'energy_callback',
        eventKey,
        orderId: normalized.outTradeNo ?? null,
        headers: buildHeadersRecord(input.request.headers),
        payload: input.payload,
        rawBody: input.rawBody,
        signatureValid,
        processed: false,
        processedAt: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        logger.info(
          {
            provider: 'itrx',
            eventKey,
          },
          'Callback duplicado de iTRX ignorado por idempotencia',
        );
        return {
          duplicate: true,
          event: await this.providerEventRepository.findByEventKey(eventKey),
        };
      }

      throw error;
    }

    const correlation = await this.correlateItrxOrder(normalized);
    const order = correlation.order;

    const markFailureAndThrow = async (appError: AppError): Promise<never> => {
      await this.providerEventRepository.markProcessed(eventKey, {
        processed: false,
        processedAt: new Date(),
        error: {
          code: appError.code,
          message: appError.message,
          details: appError.details,
        },
        orderId: order?.orderId ?? null,
      });

      throw appError;
    };

    if (!signatureValid) {
      logger.warn(
        {
          provider: 'itrx',
          eventKey,
          reason: 'WEBHOOK_SIGNATURE_INVALID',
        },
        'Callback iTRX rechazado por firma invalida',
      );
      await markFailureAndThrow(
        new AppError({
          code: 'WEBHOOK_SIGNATURE_INVALID',
          statusCode: 401,
          message: 'La firma del callback iTRX es inválida.',
        }),
      );
    }

    if (!timestampFresh) {
      logger.warn(
        {
          provider: 'itrx',
          eventKey,
          reason: 'WEBHOOK_TIMESTAMP_EXPIRED',
        },
        'Callback iTRX rechazado por timestamp vencido',
      );
      await markFailureAndThrow(
        new AppError({
          code: 'WEBHOOK_TIMESTAMP_EXPIRED',
          statusCode: 401,
          message: 'El timestamp del callback iTRX está vencido.',
        }),
      );
    }

    if (!order) {
      logger.warn(
        {
          provider: 'itrx',
          eventKey,
          outTradeNo: normalized.outTradeNo,
          receiveAddress: normalized.receiveAddress,
          matchedBy: correlation.matchedBy,
          reason: correlation.reason,
        },
        'Callback iTRX rechazado por correlacion insegura o insuficiente',
      );
      await markFailureAndThrow(
        new AppError({
          code: 'ORDER_NOT_FOUND',
          statusCode: 404,
          message: 'No se encontró una orden correlacionada para el callback iTRX.',
        }),
      );
    }

    const correlatedOrder = order as NonNullable<typeof order>;

    logger.info(
      {
        provider: 'itrx',
        eventKey,
        orderId: correlatedOrder.orderId,
        matchedBy: correlation.matchedBy,
        outTradeNo: normalized.outTradeNo,
        receiveAddress: normalized.receiveAddress,
        externalStatus: normalized.status,
        externalType: normalized.type,
      },
      'Callback iTRX correlacionado',
    );

    if (normalized.status === null) {
      logger.warn(
        {
          provider: 'itrx',
          eventKey,
          orderId: correlatedOrder.orderId,
          externalType: normalized.type,
          receiveAddress: normalized.receiveAddress,
        },
        'itrx_callback_invalid_payload',
      );
    }

    const resultingOrder = await this.energyService.handleConfirmedCallback(correlatedOrder.orderId, normalized, {
      actorType: 'provider',
      actorId: `itrx:${eventKey}`,
    });

    logger.info(
      {
        provider: 'itrx',
        eventKey,
        orderId: correlatedOrder.orderId,
        currentStatus: resultingOrder.status,
        externalStatus: normalized.status,
        externalType: normalized.type,
      },
      'itrx_callback_processed',
    );

    await this.providerEventRepository.markProcessed(eventKey, {
      processed: true,
      processedAt: new Date(),
      error: null,
      orderId: correlatedOrder.orderId,
      purgeAt: this.buildSuccessfulEventPurgeAt(),
    });

    return {
      duplicate: false,
      event,
    };
  }

  public async reprocessEvent(eventId: string) {
    const event = await this.providerEventRepository.findById(eventId);
    if (!event) {
      throw new AppError({
        code: 'ORDER_NOT_FOUND',
        statusCode: 404,
        message: 'No existe el evento solicitado para reproceso.',
      });
    }

    let processedOrderId = event.orderId;

    if (event.provider === 'cryptocurrencyapi') {
      const normalized = this.cryptoCurrencyApiService.normalizeWebhookPayload(event.payload);
      const correlation = await this.correlateCryptoCurrencyApiOrder(normalized);
      const order = correlation.order;

      if (!order) {
        this.logger.warn(
          {
            provider: 'cryptocurrencyapi',
            eventId,
            matchedBy: correlation.matchedBy,
            reason: correlation.reason,
          },
          'Reproceso de evento CryptoCurrencyAPI rechazado por correlacion insegura',
        );
        throw new AppError({
          code: 'ORDER_NOT_FOUND',
          statusCode: 404,
          message: 'No se encontró una orden para reprocesar el evento.',
        });
      }

      processedOrderId = order.orderId;

      if (order.type === 'SELL' && normalized.eventType === 'deposit') {
        const actor: ActorContext = {
          actorType: 'internal',
          actorId: `reprocess:${eventId}`,
        };
        await this.processSellDepositEvent(
          order,
          normalized as NormalizedDepositEvent,
          actor,
          'manual-provider-event-reprocess',
        );
      }

      if (order.type === 'SELL' && normalized.eventType === 'forward') {
        await this.forwardsService.handleForwardWebhook(order.orderId, normalized, {
          actorType: 'internal',
          actorId: `reprocess:${eventId}`,
        });
      }

      if (
        order.type === 'BUY' &&
        (normalized.eventType === 'send' || normalized.eventType === 'forward')
      ) {
        await this.forwardsService.handleSendWebhook(order.orderId, normalized, {
          actorType: 'internal',
          actorId: `reprocess:${eventId}`,
        });
      }
    }

    if (event.provider === 'itrx') {
      const normalized = this.itrxService.normalizeCallbackPayload(event.payload);
      const correlation = await this.correlateItrxOrder(normalized);
      const orderId = correlation.order?.orderId ?? event.orderId;

      if (!orderId) {
        throw new AppError({
          code: 'ORDER_NOT_FOUND',
          statusCode: 404,
          message: 'No se puede reprocesar un callback iTRX sin orderId asociado.',
        });
      }

      await this.energyService.handleConfirmedCallback(orderId, normalized, {
        actorType: 'internal',
        actorId: `reprocess:${eventId}`,
      });
      processedOrderId = orderId;
    }

    return this.providerEventRepository.markProcessed(event.eventKey, {
      processed: true,
      processedAt: new Date(),
      error: null,
      orderId: processedOrderId,
      purgeAt: this.buildSuccessfulEventPurgeAt(),
    });
  }

  public async enqueueManualReprocessEvent(eventId: string) {
    const event = await this.providerEventRepository.findById(eventId);
    if (!event) {
      throw new AppError({
        code: 'ORDER_NOT_FOUND',
        statusCode: 404,
        message: 'No existe el evento solicitado para reproceso.',
      });
    }

    await this.outboxService.enqueueUniqueProviderEvent({
      jobType: JOB_TYPES.REPROCESS_PROVIDER_EVENT,
      providerEventId: event.id as string,
      orderId: event.orderId,
      payload: {
        providerEventId: event.id,
        orderId: event.orderId,
        reason: 'manual-provider-event-reprocess',
      },
      maxAttempts: 3,
    });

    this.logger.info(
      {
        providerEventId: event.id,
        orderId: event.orderId,
        jobType: JOB_TYPES.REPROCESS_PROVIDER_EVENT,
      },
      'manual_provider_event_reprocess_enqueued',
    );

    return event;
  }

  private buildSuccessfulEventPurgeAt(): Date {
    return new Date(
      Date.now() +
        this.config.retention.providerEventSuccessRetentionDays * 24 * 60 * 60 * 1_000,
    );
  }
}
