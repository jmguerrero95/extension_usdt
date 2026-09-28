import { describe, expect, it } from 'vitest';

import { normalizeCryptoCurrencyApiWebhookPayload } from '../../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.mapper';

describe('normalizeCryptoCurrencyApiWebhookPayload', () => {
  it('normaliza un deposito TRC20', () => {
    const normalized = normalizeCryptoCurrencyApiWebhookPayload({
      address: 'TDEPOSIT123',
      label: 'batm-001|cas-tx-123|ord_123',
      uniqID: 'sell_ord_123',
      txid: 'tx-123',
      token: 'usdt',
      network: 'tron',
      amount: '24.12',
      confirmations: '25',
      status: 'deposit_confirmed',
    });

    expect(normalized.eventType).toBe('deposit');
    expect(normalized.token).toBe('USDT');
    expect(normalized.network).toBe('TRON');
    expect(normalized.amount).toBe(24.12);
    expect(normalized.confirmations).toBe(25);
  });

  it('detecta eventos de envio BUY', () => {
    const normalized = normalizeCryptoCurrencyApiWebhookPayload({
      requestId: 'send-req-1',
      uniqID: 'send_ord_123',
      label: 'send|ord_123',
      txid: 'send-tx-1',
      status: 'send_confirmed',
    });

    expect(normalized.eventType).toBe('send');
    expect(normalized.requestId).toBe('send-req-1');
    expect(normalized.txid).toBe('send-tx-1');
  });

  it('prioriza prefijo forward aunque el status mencione send', () => {
    const normalized = normalizeCryptoCurrencyApiWebhookPayload({
      requestId: 'forward-req-1',
      uniqID: 'forward_ord_123',
      label: 'forward|ord_123',
      txid: 'forward-tx-1',
      status: 'send_confirmed',
    });

    expect(normalized.eventType).toBe('forward');
  });

  it('tolera aliases conocidos de IPN para currency y confirmation', () => {
    const normalized = normalizeCryptoCurrencyApiWebhookPayload({
      to: 'TDEPOSIT456',
      uniqID: 'sell_ord_456',
      currency: 'usdt',
      chain: 'tron',
      amount: '10',
      confirmation: '22',
      txid: 'tx-456',
    });

    expect(normalized.eventType).toBe('deposit');
    expect(normalized.token).toBe('USDT');
    expect(normalized.network).toBe('TRON');
    expect(normalized.confirmations).toBe(22);
  });
});
