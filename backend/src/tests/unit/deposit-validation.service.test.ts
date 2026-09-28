import { describe, expect, it } from 'vitest';

import type { Order } from '../../domain/entities/order.entity';
import { validateDepositForOrder } from '../../domain/services/deposit-validation.service';

const baseOrder: Order = {
  orderId: 'ord_1',
  externalRef: 'ref',
  terminalId: 'batm-001',
  type: 'SELL',
  asset: 'USDT',
  network: 'TRON',
  fiatCurrency: 'COP',
  fiatAmount: 100000,
  cryptoAmountExpected: 25,
  cryptoAmountReceived: null,
  cryptoAmountToSend: null,
  depositAddress: 'TADDR',
  depositAddressPublicKey: null,
  depositAddressPrivateKeyStored: false,
  customerDestinationAddress: null,
  buySenderAddress: null,
  providerUniqId: 'sell_ord_1',
  providerLabel: 'batm-001|ref|ord_1',
  providerGiveRequestRaw: null,
  providerForwardRequestId: null,
  providerForwardTxid: null,
  providerSendRequestId: null,
  providerSendTxid: null,
  forwardTargetAddress: 'TCENTRAL',
  status: 'WAITING_DEPOSIT',
  statusReason: null,
  expiresAt: new Date('2026-01-01T00:00:00.000Z'),
  depositDetectedAt: null,
  energyEstimatedAt: null,
  energyRequestedAt: null,
  energyConfirmedAt: null,
  forwardRequestedAt: null,
  sweepConfirmedAt: null,
  sendRequestedAt: null,
  sendConfirmedAt: null,
  completedAt: null,
  manualReviewRequired: false,
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('deposit-validation.service', () => {
  it('acepta un deposito dentro de tolerancia', () => {
    const result = validateDepositForOrder(
      baseOrder,
      {
        address: 'TADDR',
        label: 'batm-001|ref|ord_1',
        uniqID: 'sell_ord_1',
        txid: 'tx1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.5,
        confirmations: 20,
        status: 'confirmed',
        requestId: 'req1',
        rawPayload: {},
      },
      {
        minConfirmations: 20,
        minOperationalUsdt: 1,
        allowPartialDeposits: false,
        tolerancePercent: 5,
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.nextStatus).toBe('DEPOSIT_DETECTED');
  });

  it('marca manual review en deposito parcial si no esta permitido', () => {
    const result = validateDepositForOrder(
      baseOrder,
      {
        address: 'TADDR',
        label: 'batm-001|ref|ord_1',
        uniqID: 'sell_ord_1',
        txid: 'tx1',
        token: 'USDT',
        network: 'TRON',
        amount: 10,
        confirmations: 20,
        status: 'confirmed',
        requestId: 'req1',
        rawPayload: {},
      },
      {
        minConfirmations: 20,
        minOperationalUsdt: 1,
        allowPartialDeposits: false,
        tolerancePercent: 5,
      },
    );

    expect(result.manualReviewRequired).toBe(true);
    expect(result.nextStatus).toBe('ERROR_MANUAL_REVIEW');
  });
});
