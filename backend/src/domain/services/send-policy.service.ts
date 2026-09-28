import { DomainError } from '../errors/domain-error';
import type { Order } from '../entities/order.entity';

export const ensureBuySendAllowed = (order: Order, minOperationalUsdtBuy: number): number => {
  if (order.type !== 'BUY') {
    throw new DomainError(
      'INVALID_STATE_TRANSITION',
      'La orden no corresponde a un flujo BUY.',
      409,
    );
  }

  if (
    !(
      order.status === 'ENERGY_CONFIRMED' ||
      (order.status === 'ERROR_RETRYABLE' && order.energyConfirmedAt)
    )
  ) {
    throw new DomainError(
      'ENERGY_NOT_CONFIRMED',
      'La orden BUY aún no tiene energía confirmada para ejecutar el envío.',
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

  if (!order.customerDestinationAddress || !order.buySenderAddress) {
    throw new DomainError(
      'SEND_REQUEST_FAILED',
      'La orden BUY no tiene configuradas las direcciones de origen y destino requeridas.',
      422,
    );
  }

  if (order.cryptoAmountToSend === null) {
    throw new DomainError(
      'SEND_REQUEST_FAILED',
      'La orden BUY no tiene un monto crypto confirmado para enviar.',
      422,
    );
  }

  if (order.cryptoAmountToSend < minOperationalUsdtBuy) {
    throw new DomainError(
      'MANUAL_REVIEW_REQUIRED',
      'El monto a enviar en BUY es menor al mínimo operativo permitido.',
      422,
    );
  }

  return order.cryptoAmountToSend;
};
