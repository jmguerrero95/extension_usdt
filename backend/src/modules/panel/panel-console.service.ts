import PDFDocument from 'pdfkit';

import { AppError } from '../../app/errors/app-error';
import type { InternalUser } from '../../domain/entities/internal-user.entity';
import type { EnergyRequestRepository } from '../../domain/repositories/energy-request.repository';
import type { ForwardRequestRepository } from '../../domain/repositories/forward-request.repository';
import type { OrderNoteRepository } from '../../domain/repositories/order-note.repository';
import type { ProviderEventRepository } from '../../domain/repositories/provider-event.repository';
import type { SendRequestRepository } from '../../domain/repositories/send-request.repository';
import type { AdminAuditService } from './admin-audit.service';
import type { AuditService } from '../audit/audit.service';
import type { OrdersService } from '../orders/orders.service';
import type { EnergyService } from '../energy/energy.service';
import type { ForwardsService } from '../forwards/forwards.service';
import type { ReconciliationService } from '../reconciliation/reconciliation.service';
import {
  serializeEnergyRequest,
  serializeForwardRequest,
  serializeOrder,
  serializeProviderEvent,
  serializeSendRequest,
  serializeTimeline,
} from '../../shared/dto/serializers';
import type { ActorContext } from '../../shared/types/actor';
import { OrderModel } from '../../infrastructure/db/models/order.model';
import { OutboxJobModel } from '../../infrastructure/db/models/outbox-job.model';
import { ProviderEventModel } from '../../infrastructure/db/models/provider-event.model';
import { AdminAuditLogModel } from '../../infrastructure/db/models/admin-audit-log.model';
import { toDomainEntity } from '../../infrastructure/db/repositories/mongo-mappers';
import type { Order } from '../../domain/entities/order.entity';
import type { ProviderEvent } from '../../domain/entities/provider-event.entity';
import { resolveDateRange, type DateRangePreset } from '../../shared/utils/date-range';

const startOfDayUtc = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const startOfPreviousDayUtc = (): Date => {
  const today = startOfDayUtc();
  return new Date(today.getTime() - 24 * 60 * 60 * 1_000);
};

const buildActor = (user: InternalUser): ActorContext => ({
  actorType: 'panel',
  actorId: user.id as string,
});

const buildTrend = (current: number, previous: number) => ({
  current,
  previous,
  direction: current === previous ? 'flat' : current > previous ? 'up' : 'down',
  delta: current - previous,
});

export class PanelConsoleService {
  public constructor(
    private readonly auditService: AuditService,
    private readonly adminAuditService: AdminAuditService,
    private readonly ordersService: OrdersService,
    private readonly energyService: EnergyService,
    private readonly forwardsService: ForwardsService,
    private readonly reconciliationService: ReconciliationService,
    private readonly orderNoteRepository: OrderNoteRepository,
    private readonly providerEventRepository: ProviderEventRepository,
    private readonly energyRequestRepository: EnergyRequestRepository,
    private readonly forwardRequestRepository: ForwardRequestRepository,
    private readonly sendRequestRepository: SendRequestRepository,
  ) {}

  private getStringField(
    payload: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
    }

    return null;
  }

  private describeProviderEventCorrelation(
    order: Order,
    event: ProviderEvent,
  ): {
    matchedBy: string | null;
    rejectedReason: string | null;
    badges: string[];
  } {
    const payload = event.payload ?? {};
    const requestId = this.getStringField(payload, [
      'requestId',
      'request_id',
      'providerRequestId',
      'id',
    ]);
    const uniqID = this.getStringField(payload, ['uniqID', 'uniqId']);
    const label = this.getStringField(payload, ['label']);
    const address = this.getStringField(payload, [
      'address',
      'depositAddress',
      'receive_address',
      'receiveAddress',
    ]);
    const outTradeNo = this.getStringField(payload, ['out_trade_no', 'outTradeNo']);

    let matchedBy: string | null = null;

    if (
      requestId &&
      [order.providerForwardRequestId, order.providerSendRequestId]
        .filter((value): value is string => Boolean(value))
        .includes(requestId)
    ) {
      matchedBy = 'providerRequestId';
    } else if (
      uniqID &&
      [order.providerUniqId, `forward_${order.orderId}`, `send_${order.orderId}`].includes(uniqID)
    ) {
      matchedBy = 'uniqID';
    } else if (
      label &&
      [order.providerLabel, `forward|${order.orderId}`, `send|${order.orderId}`].includes(label)
    ) {
      matchedBy = 'label';
    } else if (outTradeNo && outTradeNo === order.orderId) {
      matchedBy = 'outTradeNo';
    } else if (
      address &&
      [order.depositAddress, order.customerDestinationAddress, order.buySenderAddress]
        .filter((value): value is string => Boolean(value))
        .includes(address)
    ) {
      matchedBy = address === order.depositAddress ? 'depositAddress' : 'address';
    }

    const rejectedReason =
      typeof event.error?.['message'] === 'string' ? String(event.error['message']) : null;
    const badges = [
      ...(event.processed ? ['procesado'] : ['rechazado']),
      ...(rejectedReason?.toLowerCase().includes('duplic') ? ['duplicado'] : []),
      ...(rejectedReason?.toLowerCase().includes('correl') ? ['no-correlacionado'] : []),
      ...(order.manualReviewRequired ? ['manual-review'] : []),
    ];

    return {
      matchedBy,
      rejectedReason,
      badges,
    };
  }

  private resolveReportFilters(filters: {
    preset?: DateRangePreset;
    dateFrom?: string;
    dateTo?: string;
    timezoneOffsetMinutes?: number;
    type?: 'BUY' | 'SELL';
    status?: string;
    terminalId?: string;
  }) {
    const range = resolveDateRange({
      preset: filters.preset,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      timezoneOffsetMinutes: filters.timezoneOffsetMinutes,
    });

    return {
      range,
      query: {
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.terminalId ? { terminalId: filters.terminalId } : {}),
        ...(range.from || range.to
          ? {
              createdAt: {
                ...(range.from ? { $gte: range.from } : {}),
                ...(range.to ? { $lte: range.to } : {}),
              },
            }
          : {}),
      } satisfies Record<string, unknown>,
      appliedFilters: {
        preset: range.preset,
        presetLabel: range.label,
        timezoneOffsetMinutes: range.timezoneOffsetMinutes,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        type: filters.type ?? null,
        status: filters.status ?? null,
        terminalId: filters.terminalId ?? null,
      },
    };
  }

  public async getDashboard() {
    const today = startOfDayUtc();
    const yesterday = startOfPreviousDayUtc();
    const [
      activeOrders,
      errorOrders,
      manualReviewOrders,
      buyToday,
      sellToday,
      buyYesterday,
      sellYesterday,
      completedToday,
      completedYesterday,
      expiredToday,
      rejectedWebhooks,
      pendingReconciliations,
      recentAlerts,
    ] = await Promise.all([
      OrderModel.countDocuments({
        status: {
          $nin: ['COMPLETED', 'EXPIRED', 'CANCELED', 'LATE_DEPOSIT', 'ERROR_MANUAL_REVIEW'],
        },
      }).exec(),
      OrderModel.countDocuments({
        status: { $in: ['ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'] },
      }).exec(),
      OrderModel.countDocuments({ manualReviewRequired: true }).exec(),
      OrderModel.countDocuments({ type: 'BUY', createdAt: { $gte: today } }).exec(),
      OrderModel.countDocuments({ type: 'SELL', createdAt: { $gte: today } }).exec(),
      OrderModel.countDocuments({
        type: 'BUY',
        createdAt: { $gte: yesterday, $lt: today },
      }).exec(),
      OrderModel.countDocuments({
        type: 'SELL',
        createdAt: { $gte: yesterday, $lt: today },
      }).exec(),
      OrderModel.countDocuments({ status: 'COMPLETED', updatedAt: { $gte: today } }).exec(),
      OrderModel.countDocuments({
        status: 'COMPLETED',
        updatedAt: { $gte: yesterday, $lt: today },
      }).exec(),
      OrderModel.countDocuments({ status: 'EXPIRED', updatedAt: { $gte: today } }).exec(),
      ProviderEventModel.countDocuments({ processed: false }).exec(),
      OutboxJobModel.countDocuments({
        jobType: 'RECONCILE_ORDER',
        status: { $in: ['PENDING', 'PROCESSING'] },
      }).exec(),
      OrderModel.find({
        $or: [{ manualReviewRequired: true }, { status: 'ERROR_RETRYABLE' }],
      })
        .sort({ updatedAt: -1 })
        .limit(6)
        .exec(),
    ]);

    const volumeAggregation = await OrderModel.aggregate<{
      _id: {
        type: 'BUY' | 'SELL';
        day: 'today' | 'yesterday';
      };
      fiat: number;
      cryptoExpected: number;
      cryptoReceived: number;
      cryptoSent: number;
    }>([
      {
        $match: {
          createdAt: { $gte: yesterday },
        },
      },
      {
        $group: {
          _id: {
            type: '$type',
            day: {
              $cond: [{ $gte: ['$createdAt', today] }, 'today', 'yesterday'],
            },
          },
          fiat: { $sum: '$fiatAmount' },
          cryptoExpected: { $sum: { $ifNull: ['$cryptoAmountExpected', 0] } },
          cryptoReceived: { $sum: { $ifNull: ['$cryptoAmountReceived', 0] } },
          cryptoSent: { $sum: { $ifNull: ['$cryptoAmountToSend', 0] } },
        },
      },
    ]).exec();

    const findVolume = (type: 'BUY' | 'SELL', day: 'today' | 'yesterday') =>
      volumeAggregation.find(
        (item) =>
          (item._id as { type: 'BUY' | 'SELL'; day: 'today' | 'yesterday' }).type === type &&
          (item._id as { type: 'BUY' | 'SELL'; day: 'today' | 'yesterday' }).day === day,
      );

    const buyVolume = findVolume('BUY', 'today');
    const sellVolume = findVolume('SELL', 'today');
    const buyVolumeYesterday = findVolume('BUY', 'yesterday');
    const sellVolumeYesterday = findVolume('SELL', 'yesterday');

    return {
      activeOrders,
      errorOrders,
      manualReviewOrders,
      buyToday,
      sellToday,
      completedToday,
      expiredToday,
      rejectedWebhooks,
      pendingReconciliations,
      volumeBoughtFiat: buyVolume?.fiat ?? 0,
      volumeSoldFiat: sellVolume?.fiat ?? 0,
      volumeBoughtUsdt: buyVolume?.cryptoSent ?? 0,
      volumeSoldUsdt: sellVolume?.cryptoReceived ?? sellVolume?.cryptoExpected ?? 0,
      comparisons: {
        buyToday: buildTrend(buyToday, buyYesterday),
        sellToday: buildTrend(sellToday, sellYesterday),
        completedToday: buildTrend(completedToday, completedYesterday),
        volumeBoughtFiat: buildTrend(buyVolume?.fiat ?? 0, buyVolumeYesterday?.fiat ?? 0),
        volumeSoldFiat: buildTrend(sellVolume?.fiat ?? 0, sellVolumeYesterday?.fiat ?? 0),
      },
      recentAlerts: recentAlerts.map((order) => ({
        orderId: order.orderId,
        type: order.type,
        status: order.status,
        terminalId: order.terminalId,
        updatedAt: order.updatedAt.toISOString(),
        lastErrorCode: order.lastErrorCode,
        lastErrorMessage: order.lastErrorMessage,
      })),
    };
  }

  public async searchOrders(filters: {
    q?: string;
    type?: 'BUY' | 'SELL';
    status?: string;
    terminalId?: string;
    provider?: 'cryptocurrencyapi' | 'itrx';
    manualReviewRequired?: boolean;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    skip?: number;
  }) {
    const query: Record<string, unknown> = {
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.terminalId ? { terminalId: filters.terminalId } : {}),
      ...(typeof filters.manualReviewRequired === 'boolean'
        ? { manualReviewRequired: filters.manualReviewRequired }
        : {}),
    };

    if (filters.dateFrom || filters.dateTo) {
      query['createdAt'] = {
        ...(filters.dateFrom ? { $gte: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { $lte: new Date(filters.dateTo) } : {}),
      };
    }

    if (filters.q) {
      const escaped = filters.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query['$or'] = [
        { orderId: new RegExp(escaped, 'i') },
        { externalRef: new RegExp(escaped, 'i') },
        { terminalId: new RegExp(escaped, 'i') },
        { providerForwardRequestId: new RegExp(escaped, 'i') },
        { providerSendRequestId: new RegExp(escaped, 'i') },
        { providerForwardTxid: new RegExp(escaped, 'i') },
        { providerSendTxid: new RegExp(escaped, 'i') },
        { depositAddress: new RegExp(escaped, 'i') },
        { customerDestinationAddress: new RegExp(escaped, 'i') },
        { providerUniqId: new RegExp(escaped, 'i') },
        { providerLabel: new RegExp(escaped, 'i') },
      ];
    }

    if (filters.provider === 'itrx') {
      query['$or'] = [...((query['$or'] as Array<Record<string, unknown>> | undefined) ?? []), { energyRequestedAt: { $ne: null } }];
    }

    const [documents, total] = await Promise.all([
      OrderModel.find(query)
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(filters.limit ?? 25)
        .skip(filters.skip ?? 0)
        .exec(),
      OrderModel.countDocuments(query).exec(),
    ]);

    return {
      total,
      items: documents.map((document) => serializeOrder(toDomainEntity<Order>(document))),
    };
  }

  public async getOrderDetail(orderId: string) {
    const order = await this.ordersService.getInternalOrder(orderId);
    const [timeline, providerEvents, notes, energyRequest, forwardRequest, sendRequest, retries] =
      await Promise.all([
        this.auditService.getTimeline(orderId),
        this.providerEventRepository.listByOrderId(orderId),
        this.orderNoteRepository.listByOrderId(orderId),
        this.energyRequestRepository.findLatestByOrderId(orderId),
        this.forwardRequestRepository.findLatestByOrderId(orderId),
        this.sendRequestRepository.findLatestByOrderId(orderId),
        OutboxJobModel.find({ orderId }).sort({ createdAt: -1 }).limit(20).exec(),
      ]);

    const providerEventsForPanel = providerEvents.map((event) => {
      const serialized = serializeProviderEvent(event);
      const correlation = this.describeProviderEventCorrelation(order, event);

      return {
        ...serialized,
        matchedBy: correlation.matchedBy,
        rejectedReason: correlation.rejectedReason,
        badges: correlation.badges,
      };
    });
    const lastMatchedEvent = providerEventsForPanel.find((event) => event.matchedBy);

    return {
      order: serializeOrder(order),
      timeline: serializeTimeline(timeline),
      providerEvents: providerEventsForPanel,
      notes: notes.map((note) => ({
        ...note,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      })),
      energyRequest: serializeEnergyRequest(energyRequest),
      forwardRequest: serializeForwardRequest(forwardRequest),
      sendRequest: serializeSendRequest(sendRequest),
      retries: retries.map((job) => ({
        id: String(job._id),
        jobType: job.jobType,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        lastError: job.lastError,
        runAt: job.runAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      })),
      correlation: {
        providerUniqId: order.providerUniqId,
        providerLabel: order.providerLabel,
        depositAddress: order.depositAddress,
        providerForwardRequestId: order.providerForwardRequestId,
        providerSendRequestId: order.providerSendRequestId,
        lastMatchedBy: lastMatchedEvent?.matchedBy ?? null,
      },
    };
  }

  public async addOrderNote(
    orderId: string,
    user: InternalUser,
    input: {
      note: string;
      escalation?: boolean;
    },
  ) {
    await this.ordersService.getOrderOrFail(orderId);
    const note = await this.orderNoteRepository.create({
      orderId,
      authorUserId: user.id as string,
      authorDisplayName: user.displayName,
      authorRole: user.role,
      note: input.note.trim(),
      escalation: input.escalation ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return {
      ...note,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  public async runOrderAction(
    action: 'reconcile' | 'retry-energy' | 'retry-buy-energy' | 'retry-forward' | 'retry-send' | 'mark-manual-review' | 'clear-manual-review' | 'cancel' | 'complete-manually' | 'resolve-outcome-unknown',
    orderId: string,
    user: InternalUser,
    input: {
      reason: string;
      reference?: string;
      confirmation?: boolean;
      metadata?: Record<string, unknown>;
      resolution?: 'retry' | 'complete' | 'cancel';
    },
  ) {
    const actor = buildActor(user);
    const order = await this.ordersService.getOrderOrFail(orderId);
    const previousStatus = order.status;
    let resultOrder = order;
    let resultPayload: Record<string, unknown> | null = null;

    switch (action) {
      case 'reconcile': {
        const result = await this.reconciliationService.reconcileOrder(orderId, actor);
        resultOrder = result.order;
        resultPayload = {
          actions: result.actions,
        };
        break;
      }
      case 'retry-energy': {
        const result = await this.energyService.requestEnergy(orderId, actor);
        resultOrder = result.order;
        resultPayload = {
          energyRequest: serializeEnergyRequest(result.energyRequest ?? null),
          skipped: result.skipped,
        };
        break;
      }
      case 'retry-buy-energy': {
        const result = await this.energyService.requestBuyEnergy(orderId, actor);
        resultOrder = result.order;
        resultPayload = {
          energyRequest: serializeEnergyRequest(result.energyRequest ?? null),
          skipped: result.skipped,
        };
        break;
      }
      case 'retry-forward': {
        const result = await this.forwardsService.requestForward(orderId, actor);
        resultOrder = result.order;
        resultPayload = {
          forwardRequest: serializeForwardRequest(result.forwardRequest ?? null),
          skipped: result.skipped,
        };
        break;
      }
      case 'retry-send': {
        const result = await this.forwardsService.requestBuySend(orderId, actor);
        resultOrder = result.order;
        resultPayload = {
          sendRequest: serializeSendRequest(result.sendRequest ?? null),
          skipped: result.skipped,
        };
        break;
      }
      case 'mark-manual-review':
        resultOrder = await this.ordersService.markManualReview(
          orderId,
          actor,
          input.reason,
          input.metadata,
        );
        break;
      case 'clear-manual-review':
        resultOrder = await this.ordersService.resumeManualReview(orderId, actor, input.reason, {
          ...(input.metadata ?? {}),
          source: 'panel-clear-manual-review',
        });
        resultPayload = {
          resumed: true,
        };
        break;
      case 'cancel':
        if (order.status === 'ERROR_MANUAL_REVIEW') {
          if (input.confirmation !== true) {
            throw new AppError({
              code: 'VALIDATION_ERROR',
              statusCode: 400,
              message: 'La cancelacion definitiva requiere confirmacion explicita.',
            });
          }
          resultOrder = await this.ordersService.cancelManualReviewOrder(
            orderId,
            actor,
            input.reason,
            input.reference,
          );
        } else {
          resultOrder =
            order.type === 'BUY'
              ? await this.ordersService.cancelBuyOrder(orderId, actor)
              : await this.ordersService.cancelSellOrder(orderId, actor);
        }
        break;
      case 'complete-manually':
        if (order.status === 'ERROR_MANUAL_REVIEW') {
          if (input.confirmation !== true) {
            throw new AppError({
              code: 'VALIDATION_ERROR',
              statusCode: 400,
              message: 'El cierre manual requiere confirmacion explicita.',
            });
          }
          resultOrder = await this.ordersService.completeManualReviewOrder(
            orderId,
            actor,
            input.reason,
            input.reference,
          );
          break;
        }

        if (order.type !== 'BUY' || !['DELIVERY_CONFIRMED', 'READY_FOR_PAYOUT'].includes(order.status)) {
          throw new AppError({
            code: 'INVALID_STATE_TRANSITION',
            statusCode: 409,
            message:
              'El cierre manual solo se permite para BUY cuando ya existe evidencia suficiente de entrega.',
          });
        }

        resultOrder = await this.ordersService.transitionOrder(order, 'COMPLETED', {
          actor,
          reason: input.reason,
          metadata: input.metadata,
        });
        break;
      case 'resolve-outcome-unknown':
        if (input.confirmation !== true) {
          throw new AppError({
            code: 'VALIDATION_ERROR',
            statusCode: 400,
            message: 'Resolver OUTCOME_UNKNOWN requiere confirmacion explicita.',
          });
        }

        if (!input.resolution) {
          throw new AppError({
            code: 'VALIDATION_ERROR',
            statusCode: 400,
            message: 'Debe indicar la resolucion operativa: retry, complete o cancel.',
          });
        }

        resultOrder = await this.ordersService.resolveOutcomeUnknown(
          orderId,
          actor,
          input.resolution,
          input.reason,
          input.reference,
        );
        resultPayload = {
          resolution: input.resolution,
        };
        break;
      default:
        break;
    }

    return {
      order: serializeOrder(resultOrder),
      previousStatus,
      newStatus: resultOrder.status,
      result: resultPayload,
    };
  }

  public async getAuditLogs(filters?: {
    category?: 'auth' | 'security' | 'orders' | 'settings' | 'users' | 'reports';
    action?: string;
    actorUserId?: string;
    orderId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    skip?: number;
  }) {
    const logs = await this.adminAuditService.list(filters);
    return logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    }));
  }

  public async getProviderEvents(filters?: {
    provider?: 'cryptocurrencyapi' | 'itrx';
    processed?: boolean;
    orderId?: string;
    limit?: number;
    skip?: number;
  }) {
    const documents = await ProviderEventModel.find({
      ...(filters?.provider ? { provider: filters.provider } : {}),
      ...(typeof filters?.processed === 'boolean' ? { processed: filters.processed } : {}),
      ...(filters?.orderId ? { orderId: filters.orderId } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(filters?.limit ?? 100)
      .skip(filters?.skip ?? 0)
      .exec();

    return documents.map((document) =>
      serializeProviderEvent(toDomainEntity<ProviderEvent>(document)),
    );
  }

  public async buildReport(filters: {
    preset?: DateRangePreset;
    dateFrom?: string;
    dateTo?: string;
    timezoneOffsetMinutes?: number;
    type?: 'BUY' | 'SELL';
    status?: string;
    terminalId?: string;
  }) {
    const { query, appliedFilters } = this.resolveReportFilters(filters);
    const documents = await OrderModel.find(query).sort({ createdAt: -1 }).limit(1000).exec();
    const rows = documents.map((document) => toDomainEntity<Order>(document));
    const completed = rows.filter((row) => row.status === 'COMPLETED').length;
    const failed = rows.filter((row) =>
      ['ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'].includes(row.status),
    ).length;
    const manualReview = rows.filter((row) => row.manualReviewRequired).length;
    const expired = rows.filter((row) => row.status === 'EXPIRED').length;
    const completedWithDuration = rows.filter(
      (row) => row.completedAt instanceof Date && row.createdAt instanceof Date,
    );
    const averageProcessingMinutes = completedWithDuration.length
      ? Math.round(
          completedWithDuration.reduce((sum, row) => {
            const completedAt = row.completedAt as Date;
            return sum + (completedAt.getTime() - row.createdAt.getTime()) / 60_000;
          }, 0) / completedWithDuration.length,
        )
      : null;

    return {
      filters: appliedFilters,
      summary: {
        total: rows.length,
        buyCount: rows.filter((row) => row.type === 'BUY').length,
        sellCount: rows.filter((row) => row.type === 'SELL').length,
        completed,
        failed,
        manualReview,
        expired,
        totalFiatBuy: rows
          .filter((row) => row.type === 'BUY')
          .reduce((sum, row) => sum + row.fiatAmount, 0),
        totalFiatSell: rows
          .filter((row) => row.type === 'SELL')
          .reduce((sum, row) => sum + row.fiatAmount, 0),
        totalUsdtSent: rows.reduce((sum, row) => sum + (row.cryptoAmountToSend ?? 0), 0),
        totalUsdtReceived: rows.reduce(
          (sum, row) => sum + (row.cryptoAmountReceived ?? row.cryptoAmountExpected ?? 0),
          0,
        ),
        averageProcessingMinutes,
      },
      rows: rows.map((row) => serializeOrder(row)),
    };
  }

  public async exportReportCsv(filters: {
    preset?: DateRangePreset;
    dateFrom?: string;
    dateTo?: string;
    timezoneOffsetMinutes?: number;
    type?: 'BUY' | 'SELL';
    status?: string;
    terminalId?: string;
  }): Promise<string> {
    const report = await this.buildReport(filters);
    const fields = [
      'orderId',
      'type',
      'status',
      'externalRef',
      'terminalId',
      'fiatAmount',
      'cryptoAmountExpected',
      'cryptoAmountReceived',
      'cryptoAmountToSend',
      'depositAddress',
      'customerDestinationAddress',
      'buySenderAddress',
      'providerForwardTxid',
      'providerSendTxid',
      'manualReviewRequired',
      'energyConfirmedAt',
      'forwardRequestedAt',
      'sendRequestedAt',
      'completedAt',
      'createdAt',
      'updatedAt',
    ] as const;

    const escapeCsv = (value: unknown): string => {
      const stringValue =
        value === null || value === undefined
          ? ''
          : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value);
      return /[",\n]/.test(stringValue)
        ? `"${stringValue.replace(/"/g, '""')}"`
        : stringValue;
    };

    const header = fields.join(',');
    const rows = report.rows.map((row) =>
      fields.map((field) => escapeCsv(row[field])).join(','),
    );

    return [header, ...rows].join('\n');
  }

  public async exportReportPdf(filters: {
    preset?: DateRangePreset;
    dateFrom?: string;
    dateTo?: string;
    timezoneOffsetMinutes?: number;
    type?: 'BUY' | 'SELL';
    status?: string;
    terminalId?: string;
  }): Promise<Buffer> {
    const report = await this.buildReport(filters);

    return new Promise<Buffer>((resolve, reject) => {
      const document = new PDFDocument({
        margin: 40,
        size: 'A4',
      });
      const chunks: Buffer[] = [];

      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);

      document.fontSize(18).text('Reporte operativo de ordenes', {
        align: 'left',
      });
      document.moveDown(0.3);
      document.fontSize(10).fillColor('#5b6462').text(`Generado: ${new Date().toISOString()}`);
      document
        .text(
          `Rango: ${report.filters.presetLabel} | ${report.filters.dateFrom ?? 'sin inicio'} -> ${report.filters.dateTo ?? 'sin fin'}`,
        )
        .text(
          `Filtros: tipo=${report.filters.type ?? 'todos'} | estado=${report.filters.status ?? 'todos'} | terminal=${report.filters.terminalId ?? 'todas'}`,
        );
      document.moveDown(0.8);

      document.fillColor('#111827').fontSize(12).text('Totales');
      document.moveDown(0.2);
      [
        `Total ordenes: ${report.summary.total}`,
        `BUY: ${report.summary.buyCount} | Volumen COP: ${report.summary.totalFiatBuy.toFixed(2)} | USDT enviados: ${report.summary.totalUsdtSent.toFixed(6)}`,
        `SELL: ${report.summary.sellCount} | Volumen COP: ${report.summary.totalFiatSell.toFixed(2)} | USDT recibidos: ${report.summary.totalUsdtReceived.toFixed(6)}`,
        `Completadas: ${report.summary.completed} | Fallidas: ${report.summary.failed} | Manual review: ${report.summary.manualReview} | Expiradas: ${report.summary.expired}`,
        `Promedio procesamiento (min): ${report.summary.averageProcessingMinutes ?? 'n/a'}`,
      ].forEach((line) => {
        document.fontSize(10).text(line);
      });

      document.moveDown(0.8);
      document.fontSize(12).text('Detalle');
      document.moveDown(0.3);

      report.rows.forEach((row, index) => {
        const detailLines = [
          `${index + 1}. ${row.orderId} | ${row.type} | ${row.status}`,
          `Fiat: ${row.fiatAmount} COP | Crypto: ${row.cryptoAmountToSend ?? row.cryptoAmountReceived ?? row.cryptoAmountExpected ?? 0} USDT`,
          `Terminal: ${row.terminalId ?? '-'} | Ref: ${row.externalRef ?? '-'} | TXID: ${row.providerSendTxid ?? row.providerForwardTxid ?? '-'}`,
          `Deposito: ${row.depositAddress ?? '-'} | Destino: ${row.customerDestinationAddress ?? '-'}`,
          `Creada: ${row.createdAt} | Actualizada: ${row.updatedAt}`,
        ];

        if (document.y > 720) {
          document.addPage();
        }

        detailLines.forEach((line) => {
          document.fontSize(9).text(line, {
            width: 520,
          });
        });
        document.moveDown(0.4);
      });

      document.end();
    });
  }

  public async getMySecurityActivity(userId: string) {
    const logs = await AdminAuditLogModel.find({
      actorUserId: userId,
      category: { $in: ['auth', 'security'] },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .exec();

    return logs.map((log) => ({
      id: String(log._id),
      category: log.category,
      action: log.action,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt.toISOString(),
      metadata: log.metadata ?? null,
    }));
  }
}
