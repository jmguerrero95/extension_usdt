/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import nock from 'nock';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildItrxSignature } from '../../infrastructure/providers/itrx/itrx.signature';
import { clearDatabase, closeTestApp, createTestApp } from '../test-helpers';

describe('api e2e', () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    nock.cleanAll();
    await clearDatabase();
  });

  afterAll(async () => {
    nock.cleanAll();
    await closeTestApp(testApp);
  });

  it('expone swagger en /docs/json', async () => {
    const response = await request(testApp.app.server).get('/docs/json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.paths['/api/v1/cas/buy-orders']).toBeDefined();
    expect(response.body.paths['/api/v1/cas/sell-orders/{orderId}/complete-payout']).toBeDefined();
  });

  it('ejecuta el contrato principal de endpoints', async () => {
    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.give')
      .query(true)
      .reply(200, {
        address: 'TDEPOSIT1234567890',
        publicKey: 'PUB123',
        privateKey: 'PRIV123',
      });

    const createResponse = await request(testApp.app.server)
      .post('/api/v1/cas/sell-orders')
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        asset: 'USDT',
        network: 'TRON',
        fiatCurrency: 'COP',
        fiatAmount: 100000,
        cryptoAmountExpected: 24.12,
        externalRef: 'cas-e2e-1',
        terminalId: 'batm-001',
      });

    expect(createResponse.status).toBe(201);
    const orderId = createResponse.body.data.orderId as string;

    const getResponse = await request(testApp.app.server)
      .get(`/api/v1/cas/sell-orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.cas);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.status).toBe('WAITING_DEPOSIT');

    const cryptoWebhook = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-e2e-1|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-tx-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 25,
        status: 'deposit_confirmed',
      });

    expect(cryptoWebhook.status).toBe(200);

    nock(testApp.config.providers.itrx.baseUrl)
      .get('/api/v1/frontend/order/price')
      .query(true)
      .reply(200, {
        period: '1H',
        energy_amount: 70000,
        total_price: 120000,
      });

    nock(testApp.config.providers.itrx.baseUrl)
      .post('/api/v1/frontend/order/collect-manual')
      .reply(200, {
        errno: 0,
        message: 'ok',
        serial: 'collect-serial-e2e-1',
        scene: 0,
        amount: 65000,
        balance: 1000,
      });

    const internalEnergyResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(internalEnergyResponse.status).toBe(202);

    const itrxPayload = {
      receive_address: 'TDEPOSIT1234567890',
      out_trade_no: orderId,
      serial: 'collect-serial-e2e-1',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'energy',
      source: 'manual',
      txid: 'itrx-chain-tx-1',
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      itrxPayload,
    );

    const itrxWebhook = await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(itrxPayload);

    expect(itrxWebhook.status).toBe(200);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'forward-req-1',
      });

    const internalForwardResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/forward`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(internalForwardResponse.status).toBe(202);

    const internalGetResponse = await request(testApp.app.server)
      .get(`/api/v1/internal/orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.internal);

    expect(internalGetResponse.status).toBe(200);
    expect(internalGetResponse.body.data.status).toBe('FORWARD_ACCEPTED');
  });

  it('proyecta un deposito observado a CAS sin adelantar el estado interno', async () => {
    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.give')
      .query(true)
      .reply(200, {
        address: 'TDEPOSIT1234567890',
        publicKey: 'PUB123',
        privateKey: 'PRIV123',
      });

    const createResponse = await request(testApp.app.server)
      .post('/api/v1/cas/sell-orders')
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        asset: 'USDT',
        network: 'TRON',
        fiatCurrency: 'COP',
        fiatAmount: 100000,
        cryptoAmountExpected: 24.12,
        externalRef: 'cas-e2e-observed-1',
        terminalId: 'batm-001',
      });

    expect(createResponse.status).toBe(201);
    const orderId = createResponse.body.data.orderId as string;

    const webhookResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-e2e-observed-1|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-observed-e2e-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 1,
        status: 'deposit_pending',
      });

    expect(webhookResponse.status).toBe(200);

    const casResponse = await request(testApp.app.server)
      .get(`/api/v1/cas/sell-orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.cas);

    expect(casResponse.status).toBe(200);
    expect(casResponse.body.data.status).toBe('DEPOSIT_DETECTED');
    expect(casResponse.body.data.cryptoAmountReceived).toBe(24.12);

    const internalResponse = await request(testApp.app.server)
      .get(`/api/v1/internal/orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.internal);

    expect(internalResponse.status).toBe(200);
    expect(internalResponse.body.data.status).toBe('WAITING_DEPOSIT');
  });

  it('ejecuta el contrato principal BUY', async () => {
    const createResponse = await request(testApp.app.server)
      .post('/api/v1/cas/buy-orders')
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        asset: 'USDT',
        network: 'TRON',
        fiatCurrency: 'COP',
        fiatAmount: 100000,
        cryptoAmountToSend: 24.12,
        customerDestinationAddress: 'TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ',
        externalRef: 'cas-buy-e2e-1',
        terminalId: 'batm-001',
      });

    expect(createResponse.status).toBe(201);
    const orderId = createResponse.body.data.orderId as string;

    const getResponse = await request(testApp.app.server)
      .get(`/api/v1/cas/buy-orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.cas);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.status).toBe('CREATED');

    nock(testApp.config.providers.itrx.baseUrl)
      .get('/api/v1/frontend/order/price')
      .query(true)
      .reply(200, {
        period: '1H',
        energy_amount: 70000,
        total_price: 120000,
      });

    nock(testApp.config.providers.itrx.baseUrl)
      .post('/api/v1/frontend/order')
      .reply(200, {
        errno: 0,
        message: 'ok',
        serial: 'itrx-buy-serial-e2e-1',
        amount: 70000,
        balance: 1000,
      });

    nock('https://api.trongrid.io')
      .post('/wallet/getaccountresource', {
        address: testApp.config.tron.buySenderAddress,
        visible: true,
      })
      .reply(200, {
        EnergyLimit: 0,
        EnergyUsed: 0,
        freeNetLimit: 600,
        freeNetUsed: 0,
      });

    const internalEnergyResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(internalEnergyResponse.status).toBe(202);

    const itrxPayload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-e2e-1',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-e2e-1',
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      itrxPayload,
    );

    const itrxWebhook = await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(itrxPayload);

    expect(itrxWebhook.status).toBe(200);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'send-e2e-req-1',
      });

    const sendBuyResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(sendBuyResponse.status).toBe(202);

    const timelineResponse = await request(testApp.app.server)
      .get(`/api/v1/cas/buy-orders/${orderId}/timeline`)
      .set('x-api-key', testApp.config.apiKeys.cas);

    expect(timelineResponse.status).toBe(200);

    const cryptoWebhook = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        requestId: 'send-e2e-req-1',
        uniqID: `send_${orderId}`,
        label: `send|${orderId}`,
        txid: 'send-e2e-tx-1',
        status: 'send_confirmed',
      });

    expect(cryptoWebhook.status).toBe(200);

    const internalGetResponse = await request(testApp.app.server)
      .get(`/api/v1/internal/orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.internal);

    expect(internalGetResponse.status).toBe(200);
    expect(internalGetResponse.body.data.status).toBe('COMPLETED');
  });

  it('permite completar una SELL por CAS despues del payout', async () => {
    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.give')
      .query(true)
      .reply(200, {
        address: 'TDEPOSIT1234567890',
        publicKey: 'PUB123',
        privateKey: 'PRIV123',
      });

    const createResponse = await request(testApp.app.server)
      .post('/api/v1/cas/sell-orders')
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        asset: 'USDT',
        network: 'TRON',
        fiatCurrency: 'COP',
        fiatAmount: 100000,
        cryptoAmountExpected: 24.12,
        externalRef: 'cas-e2e-sell-complete',
        terminalId: 'batm-001',
      });

    expect(createResponse.status).toBe(201);
    const orderId = createResponse.body.data.orderId as string;

    await testApp.services.ordersService.patchOrder(orderId, {
      status: 'READY_FOR_PAYOUT',
      cryptoAmountReceived: 24.12,
      cashPayoutEligibleAt: new Date(),
      settlementCompletedAt: new Date(),
      statusReason: 'Lista para payout en CAS',
    });

    const completeResponse = await request(testApp.app.server)
      .post(`/api/v1/cas/sell-orders/${orderId}/complete-payout`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        casTransactionId: 'cas-e2e-sell-complete',
        terminalId: 'batm-001',
      });

    expect(completeResponse.status).toBe(200);
    expect(completeResponse.body.data.status).toBe('COMPLETED');
  });
});
