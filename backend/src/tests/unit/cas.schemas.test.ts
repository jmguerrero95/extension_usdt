import { describe, expect, it } from 'vitest';

import {
  createBuyOrderBodySchema,
  createSellOrderBodySchema,
} from '../../modules/cas/cas.schemas';

describe('createSellOrderBodySchema', () => {
  it('acepta un payload valido', () => {
    const parsed = createSellOrderBodySchema.parse({
      asset: 'USDT',
      network: 'TRON',
      fiatCurrency: 'COP',
      fiatAmount: 100000,
      cryptoAmountExpected: 24.12,
      externalRef: 'cas-tx-123',
      terminalId: 'batm-001',
    });

    expect(parsed.asset).toBe('USDT');
    expect(parsed.network).toBe('TRON');
  });

  it('rechaza monedas o montos invalidos', () => {
    const result = createSellOrderBodySchema.safeParse({
      asset: 'BTC',
      network: 'TRON',
      fiatCurrency: 'COP',
      fiatAmount: 0,
    });

    expect(result.success).toBe(false);
  });
});

describe('createBuyOrderBodySchema', () => {
  it('acepta un payload BUY valido con direccion TRON', () => {
    const parsed = createBuyOrderBodySchema.parse({
      asset: 'USDT',
      network: 'TRON',
      fiatCurrency: 'COP',
      fiatAmount: 100000,
      cryptoAmountToSend: 24.12,
      customerDestinationAddress: 'TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ',
      externalRef: 'cas-buy-123',
      terminalId: 'batm-001',
    });

    expect(parsed.customerDestinationAddress).toBe(
      'TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ',
    );
  });

  it('rechaza una direccion TRON invalida', () => {
    const result = createBuyOrderBodySchema.safeParse({
      asset: 'USDT',
      network: 'TRON',
      fiatCurrency: 'COP',
      fiatAmount: 100000,
      cryptoAmountToSend: 24.12,
      customerDestinationAddress: 'INVALID_ADDRESS',
    });

    expect(result.success).toBe(false);
  });
});
