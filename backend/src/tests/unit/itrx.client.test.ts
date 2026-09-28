import axios from 'axios';
import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';

import { ItrxClient } from '../../infrastructure/providers/itrx/itrx.client';
import {
  buildItrxSignatureFromCanonicalJson,
  canonicalizeJsonForSignature,
} from '../../infrastructure/providers/itrx/itrx.signature';

describe('ItrxClient', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('envia API-KEY en la estimacion GET de energia', async () => {
    const client = new ItrxClient(
      axios.create({
        baseURL: 'https://itrx.test',
        timeout: 1_000,
      }),
      'itrx-key',
      'itrx-secret',
    );

    const scope = nock('https://itrx.test')
      .get('/api/v1/frontend/order/price')
      .matchHeader('API-KEY', 'itrx-key')
      .query({
        period: '1H',
        to_address: 'TDESTINATION',
      })
      .reply(200, {
        period: '1H',
        energy_amount: 65000,
        total_price: 123456,
      });

    await client.estimateEnergyForUsdtTransfer({
      period: '1H',
      to_address: 'TDESTINATION',
    });

    expect(scope.isDone()).toBe(true);
  });

  it('envia API-KEY al consultar order/query', async () => {
    const client = new ItrxClient(
      axios.create({
        baseURL: 'https://itrx.test',
        timeout: 1_000,
      }),
      'itrx-key',
      'itrx-secret',
    );

    const scope = nock('https://itrx.test')
      .get('/api/v1/frontend/order/query')
      .matchHeader('API-KEY', 'itrx-key')
      .query({
        out_trade_no: 'ord_123',
      })
      .reply(200, {
        errno: 0,
        order_no: 'serial-123',
        status: 30,
      });

    await client.queryOrder({
      out_trade_no: 'ord_123',
    });

    expect(scope.isDone()).toBe(true);
  });

  it('envia API-KEY al consultar Smart Delegate por receive_address', async () => {
    const client = new ItrxClient(
      axios.create({
        baseURL: 'https://itrx.test',
        timeout: 1_000,
      }),
      'itrx-key',
      'itrx-secret',
    );

    const scope = nock('https://itrx.test')
      .get('/api/v1/frontend/auto-delegate-policy')
      .matchHeader('API-KEY', 'itrx-key')
      .query({
        receive_address: 'TENERGY123',
      })
      .reply(200, {
        code: 0,
        count: 1,
        results: [],
      });

    await client.querySmartDelegatePolicy({
      receive_address: 'TENERGY123',
    });

    expect(scope.isDone()).toBe(true);
  });

  it('firma correctamente auto-delegate-policy con TIMESTAMP, SIGNATURE y API-KEY', async () => {
    const timestamp = '1712400000';
    const client = new ItrxClient(
      axios.create({
        baseURL: 'https://itrx.test',
        timeout: 1_000,
      }),
      'itrx-key',
      'itrx-secret',
    );

    const nowSpy = globalThis.Date.now;
    globalThis.Date.now = () => Number(timestamp) * 1_000;

    try {
      const body = {
        period: 5,
        receive_address: 'TENERGY123',
        max_energy: 84000,
        callback_url: 'https://api.example.com/api/v1/webhooks/itrx',
        out_trade_no: 'ord_123',
      };

      const serializedBody = canonicalizeJsonForSignature(body);
      const signature = buildItrxSignatureFromCanonicalJson(
        'itrx-secret',
        timestamp,
        serializedBody,
      );

      const scope = nock('https://itrx.test')
        .post('/api/v1/frontend/auto-delegate-policy', serializedBody)
        .matchHeader('API-KEY', 'itrx-key')
        .matchHeader('TIMESTAMP', timestamp)
        .matchHeader('SIGNATURE', signature)
        .matchHeader('Content-Type', /application\/json/)
        .reply(200, {
          errno: 0,
          message: 'ok',
        });

      await client.createOrUpdateSmartDelegatePolicy(body);

      expect(scope.isDone()).toBe(true);
    } finally {
      globalThis.Date.now = nowSpy;
    }
  });

  it('firma correctamente collect-manual con TIMESTAMP, SIGNATURE y API-KEY', async () => {
    const timestamp = '1712400000';
    const client = new ItrxClient(
      axios.create({
        baseURL: 'https://itrx.test',
        timeout: 1_000,
      }),
      'itrx-key',
      'itrx-secret',
    );

    const nowSpy = globalThis.Date.now;
    globalThis.Date.now = () => Number(timestamp) * 1_000;

    try {
      const body = {
        scene: 0,
        receive_address: 'TSELLDEPOSIT123',
        to_address: 'TCENTRAL123',
        callback_url: 'https://api.example.com/api/v1/webhooks/itrx',
        out_trade_no: 'ord_sell_123',
      };

      const serializedBody = canonicalizeJsonForSignature(body);
      const signature = buildItrxSignatureFromCanonicalJson(
        'itrx-secret',
        timestamp,
        serializedBody,
      );

      const scope = nock('https://itrx.test')
        .post('/api/v1/frontend/order/collect-manual', serializedBody)
        .matchHeader('API-KEY', 'itrx-key')
        .matchHeader('TIMESTAMP', timestamp)
        .matchHeader('SIGNATURE', signature)
        .matchHeader('Content-Type', /application\/json/)
        .reply(200, {
          errno: 0,
          message: 'ok',
          serial: 'collect-serial-1',
          scene: 0,
          amount: 65000,
          balance: 12.34,
        });

      await client.createCollectionOrder(body);

      expect(scope.isDone()).toBe(true);
    } finally {
      globalThis.Date.now = nowSpy;
    }
  });

  it('firma correctamente la orden one-off con TIMESTAMP, SIGNATURE y API-KEY', async () => {
    const timestamp = '1712400000';
    const client = new ItrxClient(
      axios.create({
        baseURL: 'https://itrx.test',
        timeout: 1_000,
      }),
      'itrx-key',
      'itrx-secret',
    );

    const nowSpy = globalThis.Date.now;
    globalThis.Date.now = () => Number(timestamp) * 1_000;

    try {
      const body = {
        energy_amount: 70000,
        period: '1H',
        receive_address: 'TBUYSENDER123',
        active: 0,
        exclusive: 0,
        callback_url: 'https://api.example.com/api/v1/webhooks/itrx',
        out_trade_no: 'ord_buy_123',
      };

      const serializedBody = canonicalizeJsonForSignature(body);
      const signature = buildItrxSignatureFromCanonicalJson(
        'itrx-secret',
        timestamp,
        serializedBody,
      );

      const scope = nock('https://itrx.test')
        .post('/api/v1/frontend/order', serializedBody)
        .matchHeader('API-KEY', 'itrx-key')
        .matchHeader('TIMESTAMP', timestamp)
        .matchHeader('SIGNATURE', signature)
        .matchHeader('Content-Type', /application\/json/)
        .reply(200, {
          errno: 0,
          message: 'ok',
          serial: 'one-off-serial-1',
          amount: 70000,
          balance: 12.34,
        });

      await client.createOneOffEnergyOrder(body);

      expect(scope.isDone()).toBe(true);
    } finally {
      globalThis.Date.now = nowSpy;
    }
  });

  it('firma correctamente change-status de Smart Delegate con TIMESTAMP, SIGNATURE y API-KEY', async () => {
    const timestamp = '1712400000';
    const client = new ItrxClient(
      axios.create({
        baseURL: 'https://itrx.test',
        timeout: 1_000,
      }),
      'itrx-key',
      'itrx-secret',
    );

    const nowSpy = globalThis.Date.now;
    globalThis.Date.now = () => Number(timestamp) * 1_000;

    try {
      const body = { status: 0 };
      const serializedBody = canonicalizeJsonForSignature(body);
      const signature = buildItrxSignatureFromCanonicalJson(
        'itrx-secret',
        timestamp,
        serializedBody,
      );

      const scope = nock('https://itrx.test')
        .post('/api/v1/frontend/auto-delegate-policy/123/change-status', serializedBody)
        .matchHeader('API-KEY', 'itrx-key')
        .matchHeader('TIMESTAMP', timestamp)
        .matchHeader('SIGNATURE', signature)
        .matchHeader('Content-Type', /application\/json/)
        .reply(200, {
          errno: 0,
          message: 'ok',
        });

      await client.changeSmartDelegatePolicyStatus(123, body);

      expect(scope.isDone()).toBe(true);
    } finally {
      globalThis.Date.now = nowSpy;
    }
  });

  it('rechaza una respuesta HTTP 200 si errno es distinto de 0', async () => {
    const client = new ItrxClient(
      axios.create({
        baseURL: 'https://itrx.test',
        timeout: 1_000,
      }),
      'itrx-key',
      'itrx-secret',
    );

    const body = {
      period: 5,
      receive_address: 'TENERGY123',
      max_energy: 84000,
      callback_url: 'https://api.example.com/api/v1/webhooks/itrx',
      out_trade_no: 'ord_123',
    };

    nock('https://itrx.test')
      .post('/api/v1/frontend/auto-delegate-policy')
      .reply(200, {
        errno: 1001,
        message: 'bad request',
      });

    await expect(client.createOrUpdateSmartDelegatePolicy(body)).rejects.toMatchObject({
      name: 'ItrxBadResponseError',
      details: {
        status: 200,
        errno: 1001,
        endpoint: '/api/v1/frontend/auto-delegate-policy',
      },
    });
  });
});
