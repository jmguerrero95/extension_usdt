import type { EnergyRequest } from '../../domain/entities/energy-request.entity';
import type { ForwardRequest } from '../../domain/entities/forward-request.entity';
import type { Order } from '../../domain/entities/order.entity';
import type { ProviderEvent } from '../../domain/entities/provider-event.entity';
import type { SendRequest } from '../../domain/entities/send-request.entity';
import type { TimelineItem } from '../../modules/audit/audit.service';

const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export const serializeOrder = (order: Order) => ({
  ...order,
  expiresAt: order.expiresAt.toISOString(),
  depositDetectedAt: toIso(order.depositDetectedAt),
  cashPayoutEligibleAt: toIso(order.cashPayoutEligibleAt ?? null),
  cashPayoutConfirmedAt: toIso(order.cashPayoutConfirmedAt ?? null),
  energyEstimatedAt: toIso(order.energyEstimatedAt),
  energyRequestedAt: toIso(order.energyRequestedAt),
  energyConfirmedAt: toIso(order.energyConfirmedAt),
  forwardRequestedAt: toIso(order.forwardRequestedAt),
  sweepConfirmedAt: toIso(order.sweepConfirmedAt),
  settlementCompletedAt: toIso(order.settlementCompletedAt ?? null),
  sendRequestedAt: toIso(order.sendRequestedAt),
  sendConfirmedAt: toIso(order.sendConfirmedAt),
  completedAt: toIso(order.completedAt),
  createdAt: order.createdAt.toISOString(),
  updatedAt: order.updatedAt.toISOString(),
});

export const serializeProviderEvent = (event: ProviderEvent | null) =>
  event
    ? {
        ...event,
        processedAt: toIso(event.processedAt),
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
      }
    : null;

export const serializeEnergyRequest = (request: EnergyRequest | null) =>
  request
    ? {
        ...request,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      }
    : null;

export const serializeForwardRequest = (request: ForwardRequest | null) =>
  request
    ? {
        ...request,
        requestedAt: request.requestedAt.toISOString(),
        confirmedAt: toIso(request.confirmedAt),
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      }
    : null;

export const serializeSendRequest = (request: SendRequest | null) =>
  request
    ? {
        ...request,
        requestedAt: request.requestedAt.toISOString(),
        confirmedAt: toIso(request.confirmedAt),
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      }
    : null;

export const serializeTimeline = (items: TimelineItem[]) =>
  items.map((item) => ({
    ...item,
    occurredAt: item.occurredAt.toISOString(),
  }));
