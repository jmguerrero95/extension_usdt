import type { Order } from '../entities/order.entity';
import type { OrderStatus } from '../enums/order-status';

export interface NormalizedDepositEvent {
  address: string | null;
  label: string | null;
  uniqID: string | null;
  txid: string | null;
  token: string | null;
  network: string | null;
  amount: number | null;
  confirmations: number | null;
  status: string | null;
  requestId: string | null;
  rawPayload: Record<string, unknown>;
}

export interface DepositValidationConfig {
  minConfirmations: number;
  minOperationalUsdt: number;
  allowPartialDeposits: boolean;
  tolerancePercent: number;
}

export interface DepositValidationResult {
  accepted: boolean;
  nextStatus: OrderStatus | null;
  manualReviewRequired: boolean;
  lateDeposit: boolean;
  reasonCode: string | null;
  reason: string;
  acceptedAmount: number | null;
}

const isWithinTolerance = (expected: number, amount: number, tolerancePercent: number): boolean => {
  const tolerance = expected * (tolerancePercent / 100);
  const minAccepted = expected - tolerance;
  const maxAccepted = expected + tolerance;

  return amount >= minAccepted && amount <= maxAccepted;
};

export const validateDepositForOrder = (
  order: Order,
  event: NormalizedDepositEvent,
  config: DepositValidationConfig,
): DepositValidationResult => {
  if (event.token?.toUpperCase() !== 'USDT' || event.network?.toUpperCase() !== 'TRON') {
    return {
      accepted: false,
      nextStatus: null,
      manualReviewRequired: false,
      lateDeposit: false,
      reasonCode: 'TOKEN_OR_NETWORK_UNSUPPORTED',
      reason: 'El evento no corresponde a USDT en la red TRON.',
      acceptedAmount: null,
    };
  }

  if (event.amount === null || event.confirmations === null) {
    return {
      accepted: false,
      nextStatus: null,
      manualReviewRequired: false,
      lateDeposit: false,
      reasonCode: 'DEPOSIT_FIELDS_MISSING',
      reason: 'No fue posible determinar monto o confirmaciones del depósito.',
      acceptedAmount: null,
    };
  }

  if (event.confirmations < config.minConfirmations) {
    return {
      accepted: false,
      nextStatus: null,
      manualReviewRequired: false,
      lateDeposit: false,
      reasonCode: 'INSUFFICIENT_CONFIRMATIONS',
      reason: 'El depósito aún no alcanza las confirmaciones mínimas requeridas.',
      acceptedAmount: null,
    };
  }

  if (event.amount < config.minOperationalUsdt) {
    return {
      accepted: false,
      nextStatus: 'ERROR_MANUAL_REVIEW',
      manualReviewRequired: true,
      lateDeposit: false,
      reasonCode: 'AMOUNT_BELOW_MIN_OPERATIONAL',
      reason: 'El depósito es menor al mínimo operativo configurado.',
      acceptedAmount: null,
    };
  }

  if (order.status === 'EXPIRED' || order.status === 'CANCELED') {
    return {
      accepted: false,
      nextStatus: 'LATE_DEPOSIT',
      manualReviewRequired: true,
      lateDeposit: true,
      reasonCode: 'LATE_DEPOSIT_DETECTED',
      reason: 'Se detectó un depósito luego de la expiración o cancelación de la orden.',
      acceptedAmount: event.amount,
    };
  }

  if (order.cryptoAmountExpected !== null) {
    if (isWithinTolerance(order.cryptoAmountExpected, event.amount, config.tolerancePercent)) {
      return {
        accepted: true,
        nextStatus: 'DEPOSIT_DETECTED',
        manualReviewRequired: false,
        lateDeposit: false,
        reasonCode: null,
        reason: 'Depósito válido dentro de la tolerancia configurada.',
        acceptedAmount: event.amount,
      };
    }

    const lowerBound = order.cryptoAmountExpected * (1 - config.tolerancePercent / 100);
    if (event.amount < lowerBound && !config.allowPartialDeposits) {
      return {
        accepted: false,
        nextStatus: 'ERROR_MANUAL_REVIEW',
        manualReviewRequired: true,
        lateDeposit: false,
        reasonCode: 'MANUAL_REVIEW_REQUIRED',
        reason: 'Se recibió un depósito parcial y la configuración no permite continuarlo.',
        acceptedAmount: null,
      };
    }

    if (event.amount > order.cryptoAmountExpected * (1 + config.tolerancePercent / 100)) {
      return {
        accepted: false,
        nextStatus: 'ERROR_MANUAL_REVIEW',
        manualReviewRequired: true,
        lateDeposit: false,
        reasonCode: 'MANUAL_REVIEW_REQUIRED',
        reason: 'El monto recibido excede la tolerancia configurada para la orden.',
        acceptedAmount: null,
      };
    }
  }

  return {
    accepted: true,
    nextStatus: 'DEPOSIT_DETECTED',
    manualReviewRequired: false,
    lateDeposit: false,
    reasonCode: null,
    reason: 'Depósito válido para la orden.',
    acceptedAmount: event.amount,
  };
};
