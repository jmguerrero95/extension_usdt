import { describe, expect, it } from 'vitest';

import type { Order } from '../../domain/entities/order.entity';
import { ensureForwardAllowed } from '../../domain/services/forward-policy.service';

const buildOrder = (status: Order['status'], amount: number | null): Order => ({
  orderId: 'ord_1',
  externalRef: null,
  terminalId: null,
  type: 'SELL',
  asset: 'USDT',
  network: 'TRON',
  fiatCurrency: 'COP',
  fiatAmount: 100000,
  cryptoAmountExpected: 24,
  cryptoAmountReceived: amount,
  cryptoAmountToSend: null,
  depositAddress: 'TADDR',
  depositAddressPublicKey: null,
  depositAddressPrivateKeyStored: false,
  customerDestinationAddress: null,
  buySenderAddress: null,
  providerUniqId: 'sell_ord_1',
  providerLabel: '||ord_1',
  providerGiveRequestRaw: null,
  providerForwardRequestId: null,
  providerForwardTxid: null,
  providerSendRequestId: null,
  providerSendTxid: null,
  forwardTargetAddress: 'TCENTRAL',
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

describe('forward-policy.service', () => {
  it('retorna el monto a forwardear cuando la energia ya fue confirmada', () => {
    expect(ensureForwardAllowed(buildOrder('ENERGY_CONFIRMED', 25), 1)).toBe(25);
  });

  it('rechaza forward si la energia no ha sido confirmada', () => {
    expect(() => ensureForwardAllowed(buildOrder('WAITING_DEPOSIT', 25), 1)).toThrow();
  });
});
