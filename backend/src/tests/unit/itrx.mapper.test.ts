import { describe, expect, it } from 'vitest';

import { ItrxBadResponseError } from '../../infrastructure/providers/itrx/itrx.errors';
import {
  mapCollectionManualResponse,
  mapOrderQueryResponse,
} from '../../infrastructure/providers/itrx/itrx.mapper';

describe('itrx.mapper', () => {
  it('acepta order/query cuando errno=0 y status valido', () => {
    const result = mapOrderQueryResponse({
      errno: 0,
      order_no: 'serial-123',
      out_trade_no: 'ord_123',
      receive_address: 'TENERGY123',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
    });

    expect(result.errno).toBe(0);
    expect(result.status).toBe(40);
    expect(result.serial).toBe('serial-123');
  });

  it('rechaza order/query cuando errno es distinto de 0', () => {
    expect(() =>
      mapOrderQueryResponse({
        errno: 404,
        message: 'order not found',
      }),
    ).toThrow(ItrxBadResponseError);
  });

  it('rechaza order/query mal formado aunque errno sea 0', () => {
    expect(() =>
      mapOrderQueryResponse({
        errno: 0,
        order_no: 'serial-123',
      }),
    ).toThrow(ItrxBadResponseError);
  });

  it('acepta collect-manual cuando errno=0 y serial disponible', () => {
    const result = mapCollectionManualResponse({
      errno: 0,
      message: 'ok',
      serial: 'collect-serial-1',
      scene: 0,
      amount: 65000,
      balance: 12.34,
    });

    expect(result.errno).toBe(0);
    expect(result.serial).toBe('collect-serial-1');
    expect(result.scene).toBe(0);
  });
});
