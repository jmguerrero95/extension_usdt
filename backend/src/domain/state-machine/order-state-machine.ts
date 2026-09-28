import { DomainError } from '../errors/domain-error';
import type { OrderStatus } from '../enums/order-status';
import type { Order } from '../entities/order.entity';

type OrderType = Order['type'];

const SELL_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ['ADDRESS_ASSIGNED', 'CANCELED', 'EXPIRED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  VALIDATED: ['ERROR_MANUAL_REVIEW'],
  ADDRESS_ASSIGNED: [
    'WAITING_DEPOSIT',
    'CANCELED',
    'EXPIRED',
    'ERROR_RETRYABLE',
    'ERROR_MANUAL_REVIEW',
  ],
  WAITING_DEPOSIT: ['DEPOSIT_DETECTED', 'CANCELED', 'EXPIRED', 'ERROR_MANUAL_REVIEW'],
  DEPOSIT_DETECTED: ['ENERGY_ESTIMATION_REQUESTED', 'ENERGY_REQUESTED', 'ERROR_MANUAL_REVIEW'],
  ENERGY_ESTIMATION_REQUESTED: [
    'ENERGY_ESTIMATED',
    'ENERGY_REQUESTED',
    'ERROR_RETRYABLE',
    'ERROR_MANUAL_REVIEW',
  ],
  ENERGY_ESTIMATED: ['ENERGY_REQUESTED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  ENERGY_REQUESTED: ['ENERGY_CONFIRMED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  ENERGY_CONFIRMED: ['FORWARD_REQUESTED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  FORWARD_REQUESTED: ['FORWARD_ACCEPTED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  FORWARD_ACCEPTED: ['SWEEP_CONFIRMED', 'READY_FOR_PAYOUT', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  SWEEP_CONFIRMED: ['READY_FOR_PAYOUT', 'COMPLETED', 'ERROR_MANUAL_REVIEW'],
  SEND_REQUESTED: ['ERROR_MANUAL_REVIEW'],
  SEND_ACCEPTED: ['ERROR_MANUAL_REVIEW'],
  SEND_BROADCASTED: ['ERROR_MANUAL_REVIEW'],
  DELIVERY_CONFIRMED: ['ERROR_MANUAL_REVIEW'],
  READY_FOR_PAYOUT: ['COMPLETED', 'ERROR_MANUAL_REVIEW'],
  COMPLETED: [],
  EXPIRED: ['LATE_DEPOSIT'],
  CANCELED: ['LATE_DEPOSIT'],
  LATE_DEPOSIT: [],
  ERROR_RETRYABLE: [
    'ENERGY_ESTIMATION_REQUESTED',
    'ENERGY_REQUESTED',
    'FORWARD_REQUESTED',
    'ERROR_MANUAL_REVIEW',
  ],
  ERROR_MANUAL_REVIEW: ['ERROR_RETRYABLE', 'COMPLETED', 'CANCELED'],
};

const BUY_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ['VALIDATED', 'CANCELED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  VALIDATED: [
    'ENERGY_ESTIMATION_REQUESTED',
    'ENERGY_REQUESTED',
    'ENERGY_CONFIRMED',
    'CANCELED',
    'ERROR_RETRYABLE',
    'ERROR_MANUAL_REVIEW',
  ],
  ADDRESS_ASSIGNED: ['ERROR_MANUAL_REVIEW'],
  WAITING_DEPOSIT: ['ERROR_MANUAL_REVIEW'],
  DEPOSIT_DETECTED: ['ERROR_MANUAL_REVIEW'],
  ENERGY_ESTIMATION_REQUESTED: [
    'ENERGY_ESTIMATED',
    'ENERGY_REQUESTED',
    'CANCELED',
    'ERROR_RETRYABLE',
    'ERROR_MANUAL_REVIEW',
  ],
  ENERGY_ESTIMATED: ['ENERGY_REQUESTED', 'CANCELED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  ENERGY_REQUESTED: ['ENERGY_CONFIRMED', 'CANCELED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  ENERGY_CONFIRMED: ['SEND_REQUESTED', 'CANCELED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  FORWARD_REQUESTED: ['ERROR_MANUAL_REVIEW'],
  FORWARD_ACCEPTED: ['ERROR_MANUAL_REVIEW'],
  SWEEP_CONFIRMED: ['ERROR_MANUAL_REVIEW'],
  SEND_REQUESTED: ['SEND_ACCEPTED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  SEND_ACCEPTED: ['SEND_BROADCASTED', 'DELIVERY_CONFIRMED', 'READY_FOR_PAYOUT', 'COMPLETED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  SEND_BROADCASTED: ['DELIVERY_CONFIRMED', 'READY_FOR_PAYOUT', 'COMPLETED', 'ERROR_RETRYABLE', 'ERROR_MANUAL_REVIEW'],
  DELIVERY_CONFIRMED: ['READY_FOR_PAYOUT', 'COMPLETED', 'ERROR_MANUAL_REVIEW'],
  READY_FOR_PAYOUT: ['COMPLETED', 'ERROR_MANUAL_REVIEW'],
  COMPLETED: [],
  EXPIRED: [],
  CANCELED: [],
  LATE_DEPOSIT: [],
  ERROR_RETRYABLE: [
    'ENERGY_ESTIMATION_REQUESTED',
    'ENERGY_REQUESTED',
    'SEND_REQUESTED',
    'CANCELED',
    'ERROR_MANUAL_REVIEW',
  ],
  ERROR_MANUAL_REVIEW: ['ERROR_RETRYABLE', 'COMPLETED', 'CANCELED'],
};

const TRANSITIONS_BY_TYPE: Record<OrderType, Record<OrderStatus, OrderStatus[]>> = {
  SELL: SELL_TRANSITIONS,
  BUY: BUY_TRANSITIONS,
};

const normalizeArguments = (
  orderTypeOrFromStatus: OrderType | OrderStatus,
  fromStatusOrToStatus: OrderStatus,
  toStatus?: OrderStatus,
): {
  orderType: OrderType;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
} => {
  if (toStatus) {
    return {
      orderType: orderTypeOrFromStatus as OrderType,
      fromStatus: fromStatusOrToStatus,
      toStatus,
    };
  }

  return {
    orderType: 'SELL',
    fromStatus: orderTypeOrFromStatus as OrderStatus,
    toStatus: fromStatusOrToStatus,
  };
};

export const canTransition = (
  orderTypeOrFromStatus: OrderType | OrderStatus,
  fromStatusOrToStatus: OrderStatus,
  toStatus?: OrderStatus,
): boolean => {
  const args = normalizeArguments(orderTypeOrFromStatus, fromStatusOrToStatus, toStatus);
  return (
    args.fromStatus === args.toStatus ||
    TRANSITIONS_BY_TYPE[args.orderType][args.fromStatus].includes(args.toStatus)
  );
};

export const assertValidTransition = (
  orderTypeOrFromStatus: OrderType | OrderStatus,
  fromStatusOrToStatus: OrderStatus,
  toStatus?: OrderStatus,
): void => {
  const args = normalizeArguments(orderTypeOrFromStatus, fromStatusOrToStatus, toStatus);

  if (!canTransition(args.orderType, args.fromStatus, args.toStatus)) {
    throw new DomainError(
      'INVALID_STATE_TRANSITION',
      `No se permite la transición de ${args.fromStatus} a ${args.toStatus} para ${args.orderType}.`,
      409,
      {
        orderType: args.orderType,
        fromStatus: args.fromStatus,
        toStatus: args.toStatus,
      },
    );
  }
};

export const listValidTransitions = (
  orderTypeOrStatus: OrderType | OrderStatus,
  status?: OrderStatus,
): OrderStatus[] => {
  if (status) {
    return [...TRANSITIONS_BY_TYPE[orderTypeOrStatus as OrderType][status]];
  }

  return [...TRANSITIONS_BY_TYPE['SELL'][orderTypeOrStatus as OrderStatus]];
};
