import { describe, expect, it } from 'vitest';

import type { Order } from '../../domain/entities/order.entity';
import { ensureBuySendAllowed } from '../../domain/services/send-policy.service';

const buildBuyOrder = (
  status: Order['status'],
  cryptoAmountToSend: number | null,
): Order => ({
  orderId: 'ord_buy_1',
  externalRef: null,
  terminalId: null,
  type: 'BUY',
  asset: 'USDT',
  network: 'TRON',
  fiatCurrency: 'COP',
  fiatAmount: 100000,
  cryptoAmountExpected: null,
  cryptoAmountReceived: null,
  cryptoAmountToSend,
  depositAddress: null,
  depositAddressPublicKey: null,
  depositAddressPrivateKeyStored: false,
  customerDestinationAddress: 'TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ',
  buySenderAddress: 'TBUYSENDER123456789012345678901234',
  providerUniqId: 'buy_ord_buy_1',
  providerLabel: '||ord_buy_1',
  providerGiveRequestRaw: null,
  providerForwardRequestId: null,
  providerForwardTxid: null,
  providerSendRequestId: null,
  providerSendTxid: null,
  forwardTargetAddress: null,
  status,
  statusReason: null,
  expiresAt: new Date(),
  depositDetectedAt: null,
  energyEstimatedAt: null,
  energyRequestedAt: null,
  energyConfirmedAt: status === 'ENERGY_CONFIRMED' ? new Date() : null,
  forwardRequestedAt: null,
  sweepConfirmedAt: null,
  sendRequestedAt: null,
  sendConfirmedAt: null,
  completedAt: null,
  manualReviewRequired: false,
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('send-policy.service', () => {
  it('retorna el monto a enviar cuando BUY ya tiene energia confirmada', () => {
    expect(ensureBuySendAllowed(buildBuyOrder('ENERGY_CONFIRMED', 25), 1)).toBe(25);
  });

  it('rechaza el envio BUY si la energia no ha sido confirmada', () => {
    expect(() => ensureBuySendAllowed(buildBuyOrder('CREATED', 25), 1)).toThrow();
  });
});
