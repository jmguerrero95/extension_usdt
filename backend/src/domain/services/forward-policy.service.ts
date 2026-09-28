import { DomainError } from '../errors/domain-error';
import type { Order } from '../entities/order.entity';

export const ensureForwardAllowed = (order: Order, minOperationalUsdt: number): number => {
  if (!(order.status === 'ENERGY_CONFIRMED' || (order.status === 'ERROR_RETRYABLE' && order.energyConfirmedAt))) {
    throw new DomainError(
      'ENERGY_NOT_CONFIRMED',
      'La orden aún no tiene energía confirmada para ejecutar el forward.',
      409,
    );
  }

  if (order.manualReviewRequired) {
    throw new DomainError(
      'MANUAL_REVIEW_REQUIRED',
      'La orden está bloqueada por revisión manual y no puede continuar automáticamente.',
      422,
    );
  }

  if (order.cryptoAmountReceived === null) {
    throw new DomainError(
      'FORWARD_REQUEST_FAILED',
      'La orden no tiene un monto recibido confirmado para ejecutar el forward.',
      422,
    );
  }

  if (order.cryptoAmountReceived < minOperationalUsdt) {
    throw new DomainError(
      'MANUAL_REVIEW_REQUIRED',
      'El monto a forwardear es menor al mínimo operativo permitido.',
      422,
    );
  }

  return order.cryptoAmountReceived;
};
