/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import nock from 'nock';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildItrxSignature } from '../../infrastructure/providers/itrx/itrx.signature';
import { EnergyRequestModel } from '../../infrastructure/db/models/energy-request.model';
import { ForwardRequestModel } from '../../infrastructure/db/models/forward-request.model';
import { OrderModel } from '../../infrastructure/db/models/order.model';
import { OrderStateTransitionModel } from '../../infrastructure/db/models/order-state-transition.model';
import { OutboxJobModel } from '../../infrastructure/db/models/outbox-job.model';
import { ProviderEventModel } from '../../infrastructure/db/models/provider-event.model';
import { SendRequestModel } from '../../infrastructure/db/models/send-request.model';
import { clearDatabase, closeTestApp, createTestApp } from '../test-helpers';

describe('workflow integration', () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    nock.cleanAll();
    nock('https://api.trongrid.io')
      .persist()
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
    await clearDatabase();
  });

  afterAll(async () => {
    nock.cleanAll();
    await closeTestApp(testApp);
  });

  const mockGive = () =>
    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.give')
      .query((query) => !('to' in query))
      .reply(200, {
        address: 'TDEPOSIT1234567890',
        publicKey: 'PUB123',
        privateKey: 'PRIV123',
        requestId: 'give-req-1',
      });

  const createOrder = async (externalRef = 'cas-tx-123') => {
    mockGive();
    const response = await request(testApp.app.server)
      .post('/api/v1/cas/sell-orders')
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        asset: 'USDT',
        network: 'TRON',
        fiatCurrency: 'COP',
        fiatAmount: 100000,
        cryptoAmountExpected: 24.12,
        externalRef,
        terminalId: 'batm-001',
      });

    expect(response.status).toBe(201);
    return response.body.data.orderId as string;
  };

  const confirmSellDepositByWebhook = async (orderId: string, externalRef: string, confirmations = 25) => {
    const response = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|${externalRef}|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: `deposit-${externalRef}-1`,
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations,
        status: confirmations >= 25 ? 'deposit_confirmed' : 'deposit_pending',
      });

    expect(response.status).toBe(200);
  };

  const createBuyOrder = async (cryptoAmountToSend = 24.12) => {
    const response = await request(testApp.app.server)
      .post('/api/v1/cas/buy-orders')
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        asset: 'USDT',
        network: 'TRON',
        fiatCurrency: 'COP',
        fiatAmount: 100000,
        cryptoAmountToSend,
        customerDestinationAddress: 'TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ',
        externalRef: 'cas-buy-123',
        terminalId: 'batm-001',
      });

    expect(response.status).toBe(201);
    return response.body.data.orderId as string;
  };

  const buildTronGridTransfer = (input: {
    txid: string;
    to: string;
    amount: string;
    from?: string;
    tokenSymbol?: string;
    tokenAddress?: string;
    decimals?: number;
    timestamp?: number;
  }) => ({
    transaction_id: input.txid,
    token_info: {
      symbol: input.tokenSymbol ?? 'USDT',
      address: input.tokenAddress ?? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: input.decimals ?? 6,
    },
    from: input.from ?? 'TFROM1234567890',
    to: input.to,
    value: input.amount,
    block_timestamp: input.timestamp ?? Date.now(),
  });

  const mockTronGridTransfers = (
    address: string,
    data: Array<Record<string, unknown>>,
    options?: { onlyConfirmed?: boolean; limit?: number },
  ) =>
    nock('https://api.trongrid.io')
      .get(`/v1/accounts/${address}/transactions/trc20`)
      .query(
        (query) =>
          [options?.limit ?? 20, 100].includes(Number(query['limit'])) &&
          query['only_confirmed'] === String(options?.onlyConfirmed ?? true) &&
          query['contract_address'] === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      )
      .reply(200, { data });

  const buildTronGridTransactionEvent = (input: {
    txid: string;
    from?: string;
    to: string;
    amount: string;
    blockNumber?: number;
    timestamp?: number;
    confirmed?: boolean;
  }) => ({
    transaction_id: input.txid,
    event_name: 'Transfer',
    contract_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    result: {
      from: input.from ?? 'TFROM1234567890',
      to: input.to,
      value: input.amount,
    },
    block_number: input.blockNumber ?? 1_000,
    block_timestamp: input.timestamp ?? Date.now(),
    _unconfirmed: input.confirmed === false,
  });

  const mockTronGridTransactionEvents = (txid: string, data: Array<Record<string, unknown>>) =>
    nock('https://api.trongrid.io')
      .get(`/v1/transactions/${txid}/events`)
      .reply(200, { data });

  const mockTronGridLatestBlock = (blockNumber: number) =>
    nock('https://api.trongrid.io')
      .post('/wallet/getnowblock', {})
      .reply(200, {
        block_header: {
          raw_data: {
            number: blockNumber,
          },
        },
      });

  const prepareBuyOrderForSend = async (orderId: string, input: { serial: string; txid: string }) => {
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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: input.serial,
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: input.txid,
    };
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);
  };

  const requestBuySend = async (orderId: string, providerRequestId: string) => {
    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: providerRequestId,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();
  };

  const markBuyOrderAsBroadcasted = async (orderId: string, input: { requestId: string; txid: string }) => {
    await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        requestId: input.requestId,
        uniqID: `send_${orderId}`,
        label: `send|${orderId}`,
        txid: input.txid,
        status: 'processing',
      });
  };

  it('crea una orden con Mongo en memoria', async () => {
    const orderId = await createOrder();
    const order = await testApp.services.ordersService.getInternalOrder(orderId);

    expect(order.status).toBe('WAITING_DEPOSIT');
    expect(order.depositAddress).toBe('TDEPOSIT1234567890');
    expect(order.providerUniqId).toBe(`sell_${orderId}`);
  });

  it('observa temprano un deposito SELL por webhook y proyecta DEPOSIT_DETECTED solo para CAS', async () => {
    const orderId = await createOrder('cas-tx-webhook-observed-early');

    const webhookResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-tx-webhook-observed-early|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-observed-webhook-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 1,
        status: 'deposit_pending',
      });

    expect(webhookResponse.status).toBe(200);

    const internalOrder = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(internalOrder.status).toBe('WAITING_DEPOSIT');
    expect(internalOrder.cryptoAmountReceived).toBeNull();
    expect(internalOrder.depositObservedTxid).toBe('deposit-observed-webhook-1');
    expect(internalOrder.depositObservedAmount).toBe(24.12);
    expect(internalOrder.depositObservedConfirmations).toBe(1);
    expect(internalOrder.depositObservedSource).toBe('webhook');

    const energyJobs = await OutboxJobModel.countDocuments({
      orderId,
      jobType: 'REQUEST_ENERGY',
    }).exec();
    expect(energyJobs).toBe(0);

    const casResponse = await request(testApp.app.server)
      .get(`/api/v1/cas/sell-orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.cas);

    expect(casResponse.status).toBe(200);
    expect(casResponse.body.data.status).toBe('DEPOSIT_DETECTED');
    expect(casResponse.body.data.cryptoAmountReceived).toBe(24.12);
  });

  it('verifica on-chain un webhook SELL sin direccion antes de observarlo', async () => {
    const orderId = await createOrder('cas-tx-webhook-no-address');

    mockTronGridTransactionEvents('deposit-webhook-no-address-1', [
      buildTronGridTransactionEvent({
        txid: 'deposit-webhook-no-address-1',
        to: 'TDEPOSIT1234567890',
        amount: '24120000',
        confirmed: false,
      }),
    ]);

    const webhookResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        label: `batm-001|cas-tx-webhook-no-address|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-webhook-no-address-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 1,
        status: 'deposit_pending',
      });

    expect(webhookResponse.status).toBe(200);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.depositObservedTxid).toBe('deposit-webhook-no-address-1');
    expect(order.status).toBe('WAITING_DEPOSIT');
  });

  it('rechaza un webhook SELL con direccion incorrecta y no observa fondos', async () => {
    const orderId = await createOrder('cas-tx-webhook-bad-address');

    const webhookResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TBADADDRESS1234567890',
        label: `batm-001|cas-tx-webhook-bad-address|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-webhook-bad-address-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 1,
        status: 'deposit_pending',
      });

    expect(webhookResponse.status).toBe(404);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.depositObservedTxid).toBeNull();
    expect(order.status).toBe('WAITING_DEPOSIT');
  });

  it('no observa un webhook SELL sin direccion cuando el txid no es verificable on-chain', async () => {
    const orderId = await createOrder('cas-tx-webhook-unverifiable');

    mockTronGridTransactionEvents('deposit-webhook-unverifiable-1', []);

    const webhookResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        label: `batm-001|cas-tx-webhook-unverifiable|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-webhook-unverifiable-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 1,
        status: 'deposit_pending',
      });

    expect(webhookResponse.status).toBe(502);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.depositObservedTxid).toBeNull();
    expect(order.status).toBe('WAITING_DEPOSIT');
  });

  it('observa temprano un deposito SELL por polling sin adelantar energia ni expiracion', async () => {
    const orderId = await createOrder('cas-tx-poll-observed-early');

    mockTronGridTransfers(
      'TDEPOSIT1234567890',
      [
        buildTronGridTransfer({
          txid: 'deposit-observed-poll-1',
          to: 'TDEPOSIT1234567890',
          amount: '24120000',
        }),
      ],
      { onlyConfirmed: false },
    );
    mockTronGridTransactionEvents('deposit-observed-poll-1', [
      buildTronGridTransactionEvent({
        txid: 'deposit-observed-poll-1',
        to: 'TDEPOSIT1234567890',
        amount: '24120000',
        confirmed: false,
      }),
    ]);

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('trongrid-deposit-detected');
    expect(reconcileResponse.body.data.actions).not.toContain('deposit-detected-by-polling');

    const internalOrder = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(internalOrder.status).toBe('WAITING_DEPOSIT');
    expect(internalOrder.cryptoAmountReceived).toBeNull();
    expect(internalOrder.depositObservedTxid).toBe('deposit-observed-poll-1');
    expect(internalOrder.depositObservedConfirmations).toBe(0);
    expect(internalOrder.depositObservedSource).toBe('trongrid');

    await OrderModel.updateOne(
      { orderId },
      {
        $set: {
          expiresAt: new Date(Date.now() - 60_000),
        },
      },
    ).exec();

    const expiredAttempt = await testApp.services.ordersService.expireOrderIfNeeded(orderId, {
      actorType: 'scheduler',
      actorId: 'test-observed-expire',
    });
    expect(expiredAttempt.status).toBe('WAITING_DEPOSIT');

    const energyJobs = await OutboxJobModel.countDocuments({
      orderId,
      jobType: 'REQUEST_ENERGY',
    }).exec();
    expect(energyJobs).toBe(0);

    const casResponse = await request(testApp.app.server)
      .get(`/api/v1/cas/sell-orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.cas);

    expect(casResponse.status).toBe(200);
    expect(casResponse.body.data.status).toBe('DEPOSIT_DETECTED');
    expect(casResponse.body.data.cryptoAmountReceived).toBe(24.12);
  });

  it('no observa por polling si la tx consultada por txid termina en otra direccion', async () => {
    const orderId = await createOrder('cas-tx-poll-address-mismatch');

    mockTronGridTransfers(
      'TDEPOSIT1234567890',
      [
        buildTronGridTransfer({
          txid: 'deposit-poll-address-mismatch-1',
          to: 'TDEPOSIT1234567890',
          amount: '24120000',
        }),
      ],
      { onlyConfirmed: false },
    );
    mockTronGridTransactionEvents('deposit-poll-address-mismatch-1', [
      buildTronGridTransactionEvent({
        txid: 'deposit-poll-address-mismatch-1',
        to: 'TOTHERTARGET1234567890',
        amount: '24120000',
        blockNumber: 1_000,
      }),
    ]);
    mockTronGridLatestBlock(1_024);

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('trongrid-address-mismatch');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.depositObservedTxid).toBeNull();
    expect(order.status).toBe('WAITING_DEPOSIT');
  });

  it('rescata un deposito SELL por polling cuando el webhook se pierde', async () => {
    const orderId = await createOrder('cas-tx-poll-deposit');

    mockTronGridTransfers('TDEPOSIT1234567890', [
      buildTronGridTransfer({
        txid: 'deposit-tx-poll-1',
        to: 'TDEPOSIT1234567890',
        amount: '24120000',
      }),
    ], { onlyConfirmed: false });
    mockTronGridTransactionEvents('deposit-tx-poll-1', [
      buildTronGridTransactionEvent({
        txid: 'deposit-tx-poll-1',
        to: 'TDEPOSIT1234567890',
        amount: '24120000',
        blockNumber: 1_000,
      }),
    ]);
    mockTronGridLatestBlock(1_024);

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('trongrid-deposit-detected');
    expect(reconcileResponse.body.data.actions).toContain('deposit-detected-by-polling');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('DEPOSIT_DETECTED');
    expect(order.cryptoAmountReceived).toBe(24.12);
  });

  it('bloquea la cancelacion SELL cuando ya existe un deposito observado', async () => {
    const orderId = await createOrder('cas-tx-cancel-observed');

    await OrderModel.updateOne(
      { orderId },
      {
        $set: {
          depositObservedAt: new Date(),
          depositObservedAmount: 24.12,
          depositObservedTxid: 'deposit-observed-cancel-1',
          depositObservedConfirmations: 1,
          depositObservedSource: 'webhook',
          depositObservedLastCheckedAt: new Date(),
        },
      },
    ).exec();

    const cancelResponse = await request(testApp.app.server)
      .post(`/api/v1/cas/sell-orders/${orderId}/cancel`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send();

    expect(cancelResponse.status).toBe(409);
    expect(cancelResponse.body.error.code).toBe('DEPOSIT_ALREADY_OBSERVED');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('WAITING_DEPOSIT');
    expect(order.depositObservedTxid).toBe('deposit-observed-cancel-1');
  });

  it('mantiene confirmaciones observadas monotonicamente y encola una sola energia', async () => {
    const orderId = await createOrder('cas-tx-confirmations-monotonic');

    const sendWebhook = async (confirmations: number, status: string) =>
      request(testApp.app.server)
        .post('/api/v1/webhooks/cryptocurrencyapi')
        .send({
          address: 'TDEPOSIT1234567890',
          label: `batm-001|cas-tx-confirmations-monotonic|${orderId}`,
          uniqID: `sell_${orderId}`,
          txid: 'deposit-confirmations-monotonic-1',
          token: 'USDT',
          network: 'TRON',
          amount: 24.12,
          confirmations,
          status,
        });

    expect((await sendWebhook(1, 'deposit_pending')).status).toBe(200);
    expect((await sendWebhook(25, 'deposit_confirmed')).status).toBe(200);
    expect((await sendWebhook(2, 'deposit_pending')).status).toBe(200);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('DEPOSIT_DETECTED');
    expect(order.cryptoAmountReceived).toBe(24.12);
    expect(order.depositObservedConfirmations).toBe(25);

    const energyJobs = await OutboxJobModel.countDocuments({
      orderId,
      jobType: 'REQUEST_ENERGY',
    }).exec();
    expect(energyJobs).toBe(1);
  });

  it('proyecta READY_FOR_PAYOUT a CAS con deposito SELL confirmado aunque internamente siga en DEPOSIT_DETECTED', async () => {
    const externalRef = 'cas-ready-after-confirmed-deposit';
    const orderId = await createOrder(externalRef);

    await confirmSellDepositByWebhook(orderId, externalRef);

    const internalOrder = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(internalOrder.status).toBe('DEPOSIT_DETECTED');
    expect(internalOrder.cashPayoutEligibleAt).not.toBeNull();
    expect(internalOrder.cryptoAmountReceived).toBe(24.12);

    const casResponse = await request(testApp.app.server)
      .get(`/api/v1/cas/sell-orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.cas);

    expect(casResponse.status).toBe(200);
    expect(casResponse.body.data.status).toBe('READY_FOR_PAYOUT');
    expect(casResponse.body.data.cryptoAmountReceived).toBe(24.12);
  });

  it('mantiene READY_FOR_PAYOUT para CAS mientras el settlement SELL sigue pendiente', async () => {
    const externalRef = 'cas-ready-forward-pending';
    const orderId = await createOrder(externalRef);

    await confirmSellDepositByWebhook(orderId, externalRef);
    await testApp.services.ordersService.patchOrder(orderId, {
      status: 'FORWARD_REQUESTED',
      forwardRequestedAt: new Date(),
    });

    const casResponse = await request(testApp.app.server)
      .get(`/api/v1/cas/sell-orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.cas);

    expect(casResponse.status).toBe(200);
    expect(casResponse.body.data.status).toBe('READY_FOR_PAYOUT');
  });

  it('acepta complete-payout desde DEPOSIT_DETECTED elegible sin cancelar settlement y es idempotente', async () => {
    const externalRef = 'cas-complete-payout-eligible';
    const orderId = await createOrder(externalRef);

    await confirmSellDepositByWebhook(orderId, externalRef);

    const firstResponse = await request(testApp.app.server)
      .post(`/api/v1/cas/sell-orders/${orderId}/complete-payout`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        casTransactionId: externalRef,
        terminalId: 'batm-001',
      });

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.data.status).toBe('COMPLETED');

    const firstOrder = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(firstOrder.status).toBe('DEPOSIT_DETECTED');
    expect(firstOrder.cashPayoutConfirmedAt).not.toBeNull();
    expect(firstOrder.cashPayoutCasTransactionId).toBe(externalRef);
    expect(firstOrder.cashPayoutTerminalId).toBe('batm-001');
    expect(firstOrder.completedAt).toBeNull();

    const pendingEnergyJobs = await OutboxJobModel.countDocuments({
      orderId,
      jobType: 'REQUEST_ENERGY',
      status: { $in: ['PENDING', 'RUNNING'] },
    }).exec();
    expect(pendingEnergyJobs).toBe(1);

    const secondResponse = await request(testApp.app.server)
      .post(`/api/v1/cas/sell-orders/${orderId}/complete-payout`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        casTransactionId: externalRef,
        terminalId: 'batm-001',
      });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.data.status).toBe('COMPLETED');

    const secondOrder = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(secondOrder.cashPayoutConfirmedAt?.toISOString()).toBe(
      firstOrder.cashPayoutConfirmedAt?.toISOString(),
    );

    const completedTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'COMPLETED',
    }).exec();
    expect(completedTransitions).toBe(0);
  });

  it('completa la orden cuando el settlement llega despues del cash payout', async () => {
    const externalRef = 'cas-settlement-after-payout';
    const orderId = await createOrder(externalRef);

    await confirmSellDepositByWebhook(orderId, externalRef);
    await request(testApp.app.server)
      .post(`/api/v1/cas/sell-orders/${orderId}/complete-payout`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        casTransactionId: externalRef,
        terminalId: 'batm-001',
      });

    await testApp.services.ordersService.patchOrder(orderId, {
      status: 'FORWARD_REQUESTED',
      providerForwardRequestId: 'forward-req-after-payout',
    });

    const updatedOrder = await testApp.services.forwardsService.handleForwardWebhook(
      orderId,
      {
        eventType: 'forward',
        address: testApp.config.tron.forwardTargetAddress,
        label: `forward|${orderId}`,
        uniqID: `forward_${orderId}`,
        txid: 'forward-after-payout-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 25,
        status: 'forward_confirmed',
        requestId: 'forward-req-after-payout',
        rawPayload: {
          source: 'test',
        },
      },
      { actorType: 'internal', actorId: 'test-forward-webhook' },
    );

    expect(updatedOrder.status).toBe('COMPLETED');
    expect(updatedOrder.settlementCompletedAt).not.toBeNull();
    expect(updatedOrder.completedAt).not.toBeNull();
  });

  it('permite cash payout despues de que el settlement se completo antes', async () => {
    const externalRef = 'cas-payout-after-settlement';
    const orderId = await createOrder(externalRef);

    await confirmSellDepositByWebhook(orderId, externalRef);
    await testApp.services.ordersService.patchOrder(orderId, {
      status: 'FORWARD_REQUESTED',
      providerForwardRequestId: 'forward-req-before-payout',
    });

    const prePayoutOrder = await testApp.services.forwardsService.handleForwardWebhook(
      orderId,
      {
        eventType: 'forward',
        address: testApp.config.tron.forwardTargetAddress,
        label: `forward|${orderId}`,
        uniqID: `forward_${orderId}`,
        txid: 'forward-before-payout-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 25,
        status: 'forward_confirmed',
        requestId: 'forward-req-before-payout',
        rawPayload: {
          source: 'test',
        },
      },
      { actorType: 'internal', actorId: 'test-forward-webhook' },
    );

    expect(prePayoutOrder.status).toBe('READY_FOR_PAYOUT');
    expect(prePayoutOrder.settlementCompletedAt).not.toBeNull();

    const casResponse = await request(testApp.app.server)
      .get(`/api/v1/cas/sell-orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.cas);
    expect(casResponse.body.data.status).toBe('READY_FOR_PAYOUT');

    const completeResponse = await request(testApp.app.server)
      .post(`/api/v1/cas/sell-orders/${orderId}/complete-payout`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        casTransactionId: externalRef,
        terminalId: 'batm-001',
      });

    expect(completeResponse.status).toBe(200);

    const finalOrder = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(finalOrder.status).toBe('COMPLETED');
    expect(finalOrder.completedAt).not.toBeNull();
  });

  it('no proyecta READY_FOR_PAYOUT para ordenes SELL en manual review o estados terminales negativos', async () => {
    const statuses = ['ERROR_MANUAL_REVIEW', 'CANCELED', 'EXPIRED', 'LATE_DEPOSIT'] as const;

    for (const status of statuses) {
      const orderId = await createOrder(`cas-negative-${status.toLowerCase()}`);
      await testApp.services.ordersService.patchOrder(orderId, {
        status,
        cryptoAmountReceived: 24.12,
        cashPayoutEligibleAt: new Date(),
        manualReviewRequired: status === 'ERROR_MANUAL_REVIEW',
      });

      const casResponse = await request(testApp.app.server)
        .get(`/api/v1/cas/sell-orders/${orderId}`)
        .set('x-api-key', testApp.config.apiKeys.cas);

      expect(casResponse.status).toBe(200);
      expect(casResponse.body.data.status).toBe(status);
    }
  });

  it('mantiene inmutable el monto observado para el mismo txid y manda el conflicto a revision manual', async () => {
    const orderId = await createOrder('cas-tx-amount-immutable');

    await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-tx-amount-immutable|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-amount-immutable-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 1,
        status: 'deposit_pending',
      });

    const conflictResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-tx-amount-immutable|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-amount-immutable-1',
        token: 'USDT',
        network: 'TRON',
        amount: 25.12,
        confirmations: 2,
        status: 'deposit_pending',
      });

    expect(conflictResponse.status).toBe(200);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.depositObservedAmount).toBe(24.12);
    expect(order.depositObservedTxid).toBe('deposit-amount-immutable-1');
    expect(order.status).toBe('ERROR_MANUAL_REVIEW');
  });

  it('resuelve concurrentemente mismo txid y montos distintos sin sobrescribir el deposito original', async () => {
    const orderId = await createOrder('cas-tx-concurrent-amount-conflict');

    const [firstResponse, secondResponse] = await Promise.all([
      request(testApp.app.server)
        .post('/api/v1/webhooks/cryptocurrencyapi')
        .send({
          address: 'TDEPOSIT1234567890',
          label: `batm-001|cas-tx-concurrent-amount-conflict|${orderId}`,
          uniqID: `sell_${orderId}`,
          txid: 'deposit-concurrent-amount-1',
          token: 'USDT',
          network: 'TRON',
          amount: 24.12,
          confirmations: 1,
          status: 'deposit_pending',
        }),
      request(testApp.app.server)
        .post('/api/v1/webhooks/cryptocurrencyapi')
        .send({
          address: 'TDEPOSIT1234567890',
          label: `batm-001|cas-tx-concurrent-amount-conflict|${orderId}`,
          uniqID: `sell_${orderId}`,
          txid: 'deposit-concurrent-amount-1',
          token: 'USDT',
          network: 'TRON',
          amount: 25.12,
          confirmations: 2,
          status: 'deposit_pending',
        }),
    ]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.depositObservedTxid).toBe('deposit-concurrent-amount-1');
    expect([24.12, 25.12]).toContain(order.depositObservedAmount);
    expect(order.status).toBe('ERROR_MANUAL_REVIEW');

    const energyJobs = await OutboxJobModel.countDocuments({
      orderId,
      jobType: 'REQUEST_ENERGY',
    }).exec();
    expect(energyJobs).toBe(0);

    const manualReviewTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'ERROR_MANUAL_REVIEW',
    }).exec();
    expect(manualReviewTransitions).toBe(1);
  });

  it('mantiene el mismo txid y el maximo de confirmaciones bajo observaciones concurrentes compatibles', async () => {
    const orderId = await createOrder('cas-tx-concurrent-confirmations');

    const [firstResponse, secondResponse] = await Promise.all([
      request(testApp.app.server)
        .post('/api/v1/webhooks/cryptocurrencyapi')
        .send({
          address: 'TDEPOSIT1234567890',
          label: `batm-001|cas-tx-concurrent-confirmations|${orderId}`,
          uniqID: `sell_${orderId}`,
          txid: 'deposit-concurrent-confirmations-1',
          token: 'USDT',
          network: 'TRON',
          amount: 24.12,
          confirmations: 2,
          status: 'deposit_pending',
        }),
      request(testApp.app.server)
        .post('/api/v1/webhooks/cryptocurrencyapi')
        .send({
          address: 'TDEPOSIT1234567890',
          label: `batm-001|cas-tx-concurrent-confirmations|${orderId}`,
          uniqID: `sell_${orderId}`,
          txid: 'deposit-concurrent-confirmations-1',
          token: 'USDT',
          network: 'TRON',
          amount: 24.12,
          confirmations: 5,
          status: 'deposit_pending',
        }),
    ]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.depositObservedTxid).toBe('deposit-concurrent-confirmations-1');
    expect(order.depositObservedAmount).toBe(24.12);
    expect(order.depositObservedConfirmations).toBe(5);
    expect(order.manualReviewRequired).toBe(false);
  });

  it('impide reutilizar el mismo txid entre dos ordenes SELL', async () => {
    const firstOrderId = await createOrder('cas-tx-reused-first');
    const secondOrderId = await createOrder('cas-tx-reused-second');

    const firstResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-tx-reused-first|${firstOrderId}`,
        uniqID: `sell_${firstOrderId}`,
        txid: 'deposit-reused-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 1,
        status: 'deposit_pending',
      });
    const secondResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-tx-reused-second|${secondOrderId}`,
        uniqID: `sell_${secondOrderId}`,
        txid: 'deposit-reused-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 1,
        status: 'deposit_pending',
      });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const firstOrder = await testApp.services.ordersService.getInternalOrder(firstOrderId);
    const secondOrder = await testApp.services.ordersService.getInternalOrder(secondOrderId);
    expect(firstOrder.depositObservedTxid).toBe('deposit-reused-1');
    expect(secondOrder.depositObservedTxid).toBeNull();
    expect(secondOrder.status).toBe('ERROR_MANUAL_REVIEW');

    const secondEnergyJobs = await OutboxJobModel.countDocuments({
      orderId: secondOrderId,
      jobType: 'REQUEST_ENERGY',
    }).exec();
    expect(secondEnergyJobs).toBe(0);
  });

  it('envia a revision manual una orden observada demasiado tiempo sin confirmaciones suficientes', async () => {
    const orderId = await createOrder('cas-tx-observed-timeout');

    await OrderModel.updateOne(
      { orderId },
      {
        $set: {
          depositObservedAt: new Date(Date.now() - 181 * 60_000),
          depositObservedAmount: 24.12,
          depositObservedTxid: 'deposit-timeout-1',
          depositObservedConfirmations: 1,
          depositObservedSource: 'webhook',
          depositObservedLastCheckedAt: new Date(Date.now() - 181 * 60_000),
        },
      },
    ).exec();

    mockTronGridTransactionEvents('deposit-timeout-1', [
      buildTronGridTransactionEvent({
        txid: 'deposit-timeout-1',
        to: 'TDEPOSIT1234567890',
        amount: '24120000',
        confirmed: false,
      }),
    ]);

    const firstReconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(firstReconcileResponse.status).toBe(202);
    expect(firstReconcileResponse.body.data.actions).toContain('observed-deposit-timeout-manual-review');

    const firstOrder = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(firstOrder.status).toBe('ERROR_MANUAL_REVIEW');
    expect(firstOrder.depositObservedTxid).toBe('deposit-timeout-1');

    const manualReviewJobs = await OutboxJobModel.countDocuments({
      orderId,
      jobType: 'MARK_MANUAL_REVIEW',
    }).exec();
    expect(manualReviewJobs).toBe(0);
  });

  it('no reescribe la orden en polling si las confirmaciones observadas no aumentan', async () => {
    const orderId = await createOrder('cas-tx-no-rewrite-same-confirmations');
    const observedAt = new Date(Date.now() - 60_000);

    await OrderModel.updateOne(
      { orderId },
      {
        $set: {
          depositObservedAt: observedAt,
          depositObservedAmount: 24.12,
          depositObservedTxid: 'deposit-same-confirmations-1',
          depositObservedConfirmations: 1,
          depositObservedSource: 'webhook',
          depositObservedLastCheckedAt: observedAt,
          updatedAt: observedAt,
        },
      },
    ).exec();

    mockTronGridTransactionEvents('deposit-same-confirmations-1', [
      buildTronGridTransactionEvent({
        txid: 'deposit-same-confirmations-1',
        to: 'TDEPOSIT1234567890',
        amount: '24120000',
        confirmed: false,
      }),
    ]);

    const beforeReconcile = await testApp.services.ordersService.getInternalOrder(orderId);

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.depositObservedConfirmations).toBe(1);
    expect(order.updatedAt.toISOString()).toBe(beforeReconcile.updatedAt.toISOString());
  });

  it('si reescribe la orden en polling cuando las confirmaciones observadas aumentan', async () => {
    const orderId = await createOrder('cas-tx-rewrite-higher-confirmations');
    const observedAt = new Date(Date.now() - 60_000);

    await OrderModel.updateOne(
      { orderId },
      {
        $set: {
          depositObservedAt: observedAt,
          depositObservedAmount: 24.12,
          depositObservedTxid: 'deposit-higher-confirmations-1',
          depositObservedConfirmations: 1,
          depositObservedSource: 'webhook',
          depositObservedLastCheckedAt: observedAt,
          updatedAt: observedAt,
        },
      },
    ).exec();

    mockTronGridTransactionEvents('deposit-higher-confirmations-1', [
      buildTronGridTransactionEvent({
        txid: 'deposit-higher-confirmations-1',
        to: 'TDEPOSIT1234567890',
        amount: '24120000',
        blockNumber: 1_000,
      }),
    ]);
    mockTronGridLatestBlock(1_001);

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.depositObservedConfirmations).toBe(2);
    expect(order.updatedAt.getTime()).toBeGreaterThan(observedAt.getTime());
  });

  it('GET CAS repetido no modifica MongoDB cuando solo existe proyeccion virtual', async () => {
    const orderId = await createOrder('cas-tx-get-no-write');
    const observedAt = new Date(Date.now() - 60_000);

    await OrderModel.updateOne(
      { orderId },
      {
        $set: {
          depositObservedAt: observedAt,
          depositObservedAmount: 24.12,
          depositObservedTxid: 'deposit-get-no-write-1',
          depositObservedConfirmations: 1,
          depositObservedSource: 'webhook',
          depositObservedLastCheckedAt: observedAt,
          updatedAt: observedAt,
        },
      },
    ).exec();

    const beforeReads = await testApp.services.ordersService.getInternalOrder(orderId);

    await request(testApp.app.server)
      .get(`/api/v1/cas/sell-orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.cas);
    await request(testApp.app.server)
      .get(`/api/v1/cas/sell-orders/${orderId}`)
      .set('x-api-key', testApp.config.apiKeys.cas);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.updatedAt.toISOString()).toBe(beforeReads.updatedAt.toISOString());
  });

  it('ignora transfers TRC20 que no llegan a la deposit address SELL', async () => {
    const orderId = await createOrder('cas-tx-trongrid-other-address');

    mockTronGridTransfers('TDEPOSIT1234567890', [
      buildTronGridTransfer({
        txid: 'deposit-tx-other-address',
        to: 'TOTHERADDRESS1234567890',
        amount: '24120000',
      }),
    ], { onlyConfirmed: false });

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('trongrid-no-deposit');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('WAITING_DEPOSIT');
    expect(order.cryptoAmountReceived).toBeNull();
  });

  it('ignora tokens distintos de USDT al verificar depositos SELL por TronGrid', async () => {
    const orderId = await createOrder('cas-tx-trongrid-other-token');

    mockTronGridTransfers('TDEPOSIT1234567890', [
      buildTronGridTransfer({
        txid: 'deposit-tx-other-token',
        to: 'TDEPOSIT1234567890',
        amount: '24120000',
        tokenSymbol: 'USDC',
        tokenAddress: 'TUSDCCONTRACT1234567890',
      }),
    ], { onlyConfirmed: false });

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('trongrid-no-deposit');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('WAITING_DEPOSIT');
    expect(order.cryptoAmountReceived).toBeNull();
  });

  it('respeta la tolerancia del monto SELL al detectar depositos por TronGrid', async () => {
    const orderId = await createOrder('cas-tx-trongrid-tolerance');

    mockTronGridTransfers('TDEPOSIT1234567890', [
      buildTronGridTransfer({
        txid: 'deposit-tx-tolerance',
        to: 'TDEPOSIT1234567890',
        amount: '24500000',
      }),
    ], { onlyConfirmed: false });
    mockTronGridTransactionEvents('deposit-tx-tolerance', [
      buildTronGridTransactionEvent({
        txid: 'deposit-tx-tolerance',
        to: 'TDEPOSIT1234567890',
        amount: '24500000',
        blockNumber: 1_000,
      }),
    ]);
    mockTronGridLatestBlock(1_024);

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('deposit-detected-by-polling');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('DEPOSIT_DETECTED');
    expect(order.cryptoAmountReceived).toBe(24.5);
  });

  it('manda a revision manual un deposito SELL que excede la tolerancia por TronGrid', async () => {
    const orderId = await createOrder('cas-tx-trongrid-over-limit');

    mockTronGridTransfers('TDEPOSIT1234567890', [
      buildTronGridTransfer({
        txid: 'deposit-tx-over-limit',
        to: 'TDEPOSIT1234567890',
        amount: '30000000',
      }),
    ], { onlyConfirmed: false });
    mockTronGridTransactionEvents('deposit-tx-over-limit', [
      buildTronGridTransactionEvent({
        txid: 'deposit-tx-over-limit',
        to: 'TDEPOSIT1234567890',
        amount: '30000000',
        blockNumber: 1_000,
      }),
    ]);
    mockTronGridLatestBlock(1_024);

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('manual-review-required');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ERROR_MANUAL_REVIEW');
    expect(order.manualReviewRequired).toBe(true);
  });

  it('no vuelve a consultar TronGrid si la orden SELL ya tiene monto detectado', async () => {
    const orderId = await createOrder('cas-tx-trongrid-already-detected');

    await OrderModel.updateOne(
      { orderId },
      {
        $set: {
          cryptoAmountReceived: 24.12,
        },
      },
    ).exec();

    const tronGridScope = mockTronGridTransfers('TDEPOSIT1234567890', []);

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('deposit-already-recorded');
    expect(tronGridScope.isDone()).toBe(false);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.cryptoAmountReceived).toBe(24.12);
  });

  it('mantiene un unico job de reconcile y lo programa a ~10 segundos para orden abierta', async () => {
    const orderId = await createOrder('cas-tx-poll-interval');

    mockTronGridTransfers('TDEPOSIT1234567890', [], { onlyConfirmed: false });

    const response = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(response.status).toBe(202);

    const pendingJobs = await OutboxJobModel.find({
      orderId,
      jobType: 'RECONCILE_ORDER',
      status: { $in: ['PENDING', 'RUNNING'] },
    })
      .sort({ createdAt: -1 })
      .exec();

    expect(pendingJobs).toHaveLength(1);

    const nextJob = pendingJobs[0]!;
    expect(nextJob).toBeDefined();

    const nextRunInMs = nextJob.runAt.getTime() - Date.now();
    expect(nextRunInMs).toBeGreaterThan(8_000);
    expect(nextRunInMs).toBeLessThanOrEqual(10_000);
  });

  it('no duplica RECONCILE_ORDER bajo encolado concurrente', async () => {
    const orderId = await createOrder('cas-tx-poll-concurrent-enqueue');

    await OutboxJobModel.deleteMany({ orderId, jobType: 'RECONCILE_ORDER' }).exec();

    await Promise.all(
      Array.from({ length: 8 }, () =>
        testApp.services.reconciliationService.scheduleReconciliationIfNeeded(orderId),
      ),
    );

    const pendingJobs = await OutboxJobModel.countDocuments({
      orderId,
      jobType: 'RECONCILE_ORDER',
      status: { $in: ['PENDING', 'RUNNING'] },
    }).exec();

    expect(pendingJobs).toBe(1);
  });

  it('recupera solo los jobs RUNNING stale y deja intactos los recientes', async () => {
    const now = new Date();
    const staleLockedAt = new Date(Date.now() - 120_000);
    const freshLockedAt = new Date(Date.now() - 5_000);

    const staleJob = await OutboxJobModel.create({
      jobType: 'RECONCILE_ORDER',
      orderId: 'ord_stale_recover_1',
      payload: { jobId: 'stale-1' },
      status: 'RUNNING',
      runAt: new Date(Date.now() - 60_000),
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      lockedAt: staleLockedAt,
      createdAt: now,
      updatedAt: staleLockedAt,
    });

    const freshJob = await OutboxJobModel.create({
      jobType: 'RECONCILE_ORDER',
      orderId: 'ord_stale_recover_2',
      payload: { jobId: 'fresh-1' },
      status: 'RUNNING',
      runAt: new Date(Date.now() - 60_000),
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      lockedAt: freshLockedAt,
      createdAt: now,
      updatedAt: freshLockedAt,
    });

    const completedJob = await OutboxJobModel.create({
      jobType: 'RECONCILE_ORDER',
      orderId: 'ord_stale_recover_3',
      payload: { jobId: 'completed-1' },
      status: 'COMPLETED',
      runAt: new Date(Date.now() - 60_000),
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      lockedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const recovered = await testApp.services.repositories.outboxJobRepository.recoverStaleRunningJobs(
      90_000,
    );

    expect(recovered).toBe(1);

    const reloadedStaleJob = await OutboxJobModel.findById(staleJob._id).exec();
    const reloadedFreshJob = await OutboxJobModel.findById(freshJob._id).exec();
    const reloadedCompletedJob = await OutboxJobModel.findById(completedJob._id).exec();

    expect(reloadedStaleJob?.status).toBe('PENDING');
    expect(reloadedStaleJob?.lockedAt).toBeNull();
    expect(reloadedFreshJob?.status).toBe('RUNNING');
    expect(reloadedFreshJob?.lockedAt).not.toBeNull();
    expect(reloadedCompletedJob?.status).toBe('COMPLETED');
  });

  it('evita doble reconciliacion peligrosa si una consulta remota va lenta', async () => {
    const orderId = await createOrder('cas-tx-poll-slow-reconcile');
    const actor = {
      actorType: 'internal' as const,
      actorId: 'test-reconcile-lock',
    };

    const statusScope = nock('https://api.trongrid.io')
      .get('/v1/accounts/TDEPOSIT1234567890/transactions/trc20')
      .query(
        (query) =>
          Number(query['limit']) === 20 &&
          query['only_confirmed'] === 'false' &&
          query['contract_address'] === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      )
      .delay(150)
      .reply(200, { data: [] });

    const firstReconcile = testApp.services.reconciliationService.reconcileOrder(orderId, actor);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const secondReconcile = await testApp.services.reconciliationService
      .reconcileOrder(orderId, actor)
      .then(() => null)
      .catch((error: unknown) => error);

    const firstResult = await firstReconcile;

    expect(firstResult.order.status).toBe('WAITING_DEPOSIT');
    expect(secondReconcile).toBeInstanceOf(Error);
    expect((secondReconcile as { code?: string }).code).toBe('LOCK_NOT_ACQUIRED');
    expect(statusScope.isDone()).toBe(true);
  });

  it('interrumpe un RECONCILE_ORDER RUNNING al arrancar y envia la orden a revision manual', async () => {
    const orderId = await createOrder('cas-tx-recover-startup');

    await OutboxJobModel.deleteMany({ orderId, jobType: 'RECONCILE_ORDER' }).exec();

    const staleJob = await OutboxJobModel.create({
      jobType: 'RECONCILE_ORDER',
      orderId,
      payload: { jobId: 'stale-startup-reconcile' },
      status: 'RUNNING',
      runAt: new Date(Date.now() - 60_000),
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      lockedAt: new Date(Date.now() - 120_000),
      createdAt: new Date(),
      updatedAt: new Date(Date.now() - 120_000),
    });

    const previousEnabled = testApp.config.scheduler.enabled;
    const previousPollMs = testApp.config.scheduler.pollMs;
    testApp.config.scheduler.enabled = true;
    testApp.config.scheduler.pollMs = 10_000;

    try {
      await testApp.services.scheduler.start();
      await testApp.services.scheduler.runTick();
    } finally {
      await testApp.services.scheduler.stop();
      testApp.config.scheduler.enabled = previousEnabled;
      testApp.config.scheduler.pollMs = previousPollMs;
    }

    const reloadedStaleJob = await OutboxJobModel.findById(staleJob._id).exec();
    expect(reloadedStaleJob?.status).toBe('INTERRUPTED');
    expect(reloadedStaleJob?.interruptionReason).toBe('SERVER_RESTART_REQUIRES_MANUAL_REVIEW');

    const order = await OrderModel.findOne({ orderId }).exec();
    expect(order?.status).toBe('ERROR_MANUAL_REVIEW');
    expect(order?.manualReviewRequired).toBe(true);

    const pendingReconcileJobs = await OutboxJobModel.countDocuments({
      orderId,
      jobType: 'RECONCILE_ORDER',
      status: { $in: ['PENDING', 'RUNNING'] },
    }).exec();
    expect(pendingReconcileJobs).toBe(0);
  });

  it('no repite cuarentena de startup al recuperar liderazgo dentro del mismo boot', async () => {
    const orderId = await createOrder('cas-tx-no-recover-recent');

    await OutboxJobModel.deleteMany({ orderId, jobType: 'RECONCILE_ORDER' }).exec();

    const recentJob = await OutboxJobModel.create({
      jobType: 'RECONCILE_ORDER',
      orderId,
      payload: { jobId: 'recent-startup-reconcile' },
      status: 'RUNNING',
      runAt: new Date(Date.now() - 60_000),
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      lockedAt: new Date(Date.now() - 5_000),
      createdAt: new Date(),
      updatedAt: new Date(Date.now() - 5_000),
    });

    const previousEnabled = testApp.config.scheduler.enabled;
    const previousPollMs = testApp.config.scheduler.pollMs;
    testApp.config.scheduler.enabled = true;
    testApp.config.scheduler.pollMs = 10_000;

    try {
      await testApp.services.scheduler.start();
    } finally {
      await testApp.services.scheduler.stop();
      testApp.config.scheduler.enabled = previousEnabled;
      testApp.config.scheduler.pollMs = previousPollMs;
    }

    const reloadedRecentJob = await OutboxJobModel.findById(recentJob._id).exec();
    expect(reloadedRecentJob?.status).toBe('RUNNING');
    expect(reloadedRecentJob?.lockedAt).not.toBeNull();

    const order = await OrderModel.findOne({ orderId }).exec();
    expect(order?.status).toBe('WAITING_DEPOSIT');
    expect(order?.manualReviewRequired).toBe(false);
  });

  it('la recuperacion de stale no rompe la unicidad de reconcile por orden', async () => {
    const orderId = await createOrder('cas-tx-recover-unique');

    await OutboxJobModel.deleteMany({ orderId, jobType: 'RECONCILE_ORDER' }).exec();

    await OutboxJobModel.create({
      jobType: 'RECONCILE_ORDER',
      orderId,
      payload: { jobId: 'stale-unique-reconcile' },
      status: 'RUNNING',
      runAt: new Date(Date.now() - 60_000),
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      lockedAt: new Date(Date.now() - 120_000),
      createdAt: new Date(),
      updatedAt: new Date(Date.now() - 120_000),
    });

    const recovered = await testApp.services.repositories.outboxJobRepository.recoverStaleRunningJobs(
      90_000,
    );
    expect(recovered).toBe(1);

    await Promise.all(
      Array.from({ length: 5 }, () =>
        testApp.services.reconciliationService.scheduleReconciliationIfNeeded(orderId),
      ),
    );

    const pendingJobs = await OutboxJobModel.countDocuments({
      orderId,
      jobType: 'RECONCILE_ORDER',
      status: { $in: ['PENDING', 'RUNNING'] },
    }).exec();

    expect(pendingJobs).toBe(1);
  });

  it('no reencola automaticamente eventos fallidos anteriores al boot', async () => {
    const event = await ProviderEventModel.create({
      provider: 'cryptocurrencyapi',
      eventType: 'deposit',
      eventKey: 'old-failed-event',
      orderId: null,
      headers: {},
      payload: { event: 'old' },
      rawBody: null,
      signatureValid: null,
      processed: false,
      processedAt: null,
      error: { code: 'ORDER_NOT_FOUND' },
      createdAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
    });

    await testApp.services.reconciliationService.seedPendingJobs();

    const jobs = await OutboxJobModel.find({
      jobType: 'REPROCESS_PROVIDER_EVENT',
      providerEventId: String(event._id),
    }).exec();
    expect(jobs).toHaveLength(0);
  });

  it('reprocesar manualmente un evento crea job con providerEventId separado de orderId', async () => {
    const event = await ProviderEventModel.create({
      provider: 'cryptocurrencyapi',
      eventType: 'deposit',
      eventKey: 'manual-reprocess-event',
      orderId: null,
      headers: {},
      payload: { event: 'manual' },
      rawBody: null,
      signatureValid: null,
      processed: false,
      processedAt: null,
      error: { code: 'ORDER_NOT_FOUND' },
      createdAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
    });

    await testApp.services.providerEventsService.enqueueManualReprocessEvent(String(event._id));

    const job = await OutboxJobModel.findOne({
      jobType: 'REPROCESS_PROVIDER_EVENT',
      providerEventId: String(event._id),
    }).exec();
    expect(job?.orderId).toBeNull();
    expect(job?.payload['providerEventId']).toBe(String(event._id));
  });

  it('un MARK_MANUAL_REVIEW fallido no crea otro MARK_MANUAL_REVIEW', async () => {
    await OutboxJobModel.create({
      jobType: 'MARK_MANUAL_REVIEW',
      orderId: 'ord_missing_for_manual_review',
      payload: { reason: 'missing order' },
      status: 'PENDING',
      runAt: new Date(0),
      attempts: 0,
      maxAttempts: 1,
      lastError: null,
      lockedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await testApp.services.scheduler.runTick();

    const jobs = await OutboxJobModel.find({
      jobType: 'MARK_MANUAL_REVIEW',
      orderId: 'ord_missing_for_manual_review',
    }).exec();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('FAILED');
  });

  it('la reconciliacion singleton reinicia fallos consecutivos tras exitos', async () => {
    const orderId = await createOrder('cas-tx-reconcile-counters');
    await OutboxJobModel.deleteMany({ orderId, jobType: 'RECONCILE_ORDER' }).exec();

    const job = await OutboxJobModel.create({
      jobType: 'RECONCILE_ORDER',
      orderId,
      payload: { jobId: 'counter-reconcile' },
      status: 'RUNNING',
      runAt: new Date(0),
      attempts: 77,
      maxAttempts: 3,
      lastError: null,
      lockedAt: new Date(),
      lockedBy: 'worker-counters',
      executionCount: 99,
      consecutiveFailureCount: 5,
      purgeAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await testApp.services.repositories.outboxJobRepository.rescheduleRunningReconcileJob(
      String(job._id),
      'worker-counters',
      new Date(Date.now() + 10_000),
    );

    let reloaded = await OutboxJobModel.findById(job._id).exec();
    expect(reloaded?.status).toBe('PENDING');
    expect(reloaded?.executionCount).toBe(100);
    expect(reloaded?.attempts).toBe(0);
    expect(reloaded?.consecutiveFailureCount).toBe(0);
    expect(reloaded?.purgeAt).toBeFalsy();

    const claimed = await testApp.services.repositories.outboxJobRepository.claimJob(
      String(job._id),
      new Date(Date.now() + 20_000),
      'worker-counters',
    );
    expect(claimed?.attempts).toBe(0);

    await testApp.services.repositories.outboxJobRepository.failJob(
      String(job._id),
      'transient',
      new Date(Date.now() + 30_000),
    );

    reloaded = await OutboxJobModel.findById(job._id).exec();
    expect(reloaded?.attempts).toBe(1);
    expect(reloaded?.consecutiveFailureCount).toBe(1);
  });

  it('reutiliza un solo documento RECONCILE_ORDER durante 1000 ciclos', async () => {
    const orderId = await createOrder('cas-tx-reconcile-1000-cycles');
    await OutboxJobModel.deleteMany({ orderId, jobType: 'RECONCILE_ORDER' }).exec();

    const job = await OutboxJobModel.create({
      jobType: 'RECONCILE_ORDER',
      orderId,
      payload: { jobId: 'reconcile-1000-cycles' },
      status: 'RUNNING',
      runAt: new Date(0),
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      lockedAt: new Date(),
      lockedBy: 'worker-1000',
      executionCount: 0,
      consecutiveFailureCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    for (let iteration = 0; iteration < 1000; iteration += 1) {
      const rescheduled = await testApp.services.repositories.outboxJobRepository.rescheduleRunningReconcileJob(
        String(job._id),
        'worker-1000',
        new Date(Date.now() + iteration + 1),
      );
      expect(rescheduled).toBe(true);

      if (iteration < 999) {
        const claimed = await testApp.services.repositories.outboxJobRepository.claimJob(
          String(job._id),
          new Date(Date.now() + iteration + 2),
          'worker-1000',
        );
        expect(claimed?.status).toBe('RUNNING');
      }
    }

    const reconcileJobs = await OutboxJobModel.find({
      orderId,
      jobType: 'RECONCILE_ORDER',
    }).exec();
    const reloaded = await OutboxJobModel.findById(job._id).exec();

    expect(reconcileJobs).toHaveLength(1);
    expect(reloaded?.status).toBe('PENDING');
    expect(reloaded?.executionCount).toBe(1000);
    expect(reloaded?.purgeAt).toBeFalsy();
  });

  it('reanudar manualmente crea un job nuevo y no reutiliza el interrumpido', async () => {
    const order = await OrderModel.create({
      orderId: 'ord_manual_resume_1',
      externalRef: 'manual-resume',
      terminalId: 'batm-001',
      type: 'SELL',
      asset: 'USDT',
      network: 'TRON',
      fiatCurrency: 'COP',
      fiatAmount: 100000,
      cryptoAmountExpected: 24.12,
      cryptoAmountReceived: 24.12,
      depositAddress: 'TDEPOSIT1234567890',
      depositAddressPublicKey: 'PUB123',
      depositAddressPrivateKeyStored: false,
      customerDestinationAddress: null,
      buySenderAddress: null,
      providerUniqId: 'sell_ord_manual_resume_1',
      providerLabel: 'batm-001|manual-resume|ord_manual_resume_1',
      providerGiveRequestRaw: null,
      providerForwardRequestId: null,
      providerForwardTxid: null,
      providerSendRequestId: null,
      providerSendTxid: null,
      forwardTargetAddress: testApp.config.tron.forwardTargetAddress,
      status: 'ERROR_MANUAL_REVIEW',
      statusReason: 'restart',
      expiresAt: new Date(Date.now() + 60_000),
      depositDetectedAt: new Date(),
      energyEstimatedAt: null,
      energyRequestedAt: null,
      energyConfirmedAt: null,
      forwardRequestedAt: null,
      sweepConfirmedAt: null,
      sendRequestedAt: null,
      sendConfirmedAt: null,
      completedAt: null,
      manualReviewRequired: true,
      recoveryGeneration: 0,
      lastErrorCode: 'MANUAL_REVIEW_REQUIRED',
      lastErrorMessage: 'restart',
    });

    const interrupted = await OutboxJobModel.create({
      jobType: 'REQUEST_ENERGY',
      orderId: order.orderId,
      payload: { jobId: 'old-job' },
      status: 'INTERRUPTED',
      runAt: new Date(0),
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      lockedAt: null,
      interruptedAt: new Date(),
      interruptionReason: 'SERVER_RESTART_REQUIRES_MANUAL_REVIEW',
    });

    const resumed = await testApp.services.ordersService.resumeManualReview(
      order.orderId,
      { actorType: 'admin', actorId: 'admin-test' },
      'Revision manual completada.',
      { source: 'test' },
    );

    expect(resumed.status).toBe('ERROR_RETRYABLE');
    expect(resumed.manualReviewRequired).toBe(false);
    expect(resumed.recoveryGeneration).toBe(1);

    const oldJob = await OutboxJobModel.findById(interrupted._id).exec();
    expect(oldJob?.status).toBe('INTERRUPTED');

    const newJob = await OutboxJobModel.findOne({
      orderId: order.orderId,
      jobType: 'REQUEST_ENERGY',
      status: 'PENDING',
    }).exec();
    expect(newJob?.payload?.['recoveryGeneration']).toBe(1);
  });

  it('procesa deposito -> energia -> forward -> ready for payout', async () => {
    const orderId = await createOrder();

    const depositResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-tx-123|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-tx-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 25,
        status: 'deposit_confirmed',
      });

    expect(depositResponse.status).toBe(200);

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
        serial: 'collect-serial-1',
        scene: 0,
        amount: 65000,
        balance: 1000,
      });

    await testApp.services.scheduler.runTick();

    let order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ENERGY_REQUESTED');

    const itrxPayload = {
      receive_address: 'TDEPOSIT1234567890',
      out_trade_no: orderId,
      serial: 'itrx-serial-1',
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

    const itrxResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(itrxPayload);

    expect(itrxResponse.status).toBe(200);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'forward-req-1',
      });

    await testApp.services.scheduler.runTick();

    order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('FORWARD_ACCEPTED');

    const forwardWebhookResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        requestId: 'forward-req-1',
        txid: 'sweep-tx-1',
        status: 'forward_confirmed',
      });

    expect(forwardWebhookResponse.status).toBe(200);

    order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('READY_FOR_PAYOUT');
    expect(order.providerForwardTxid).toBe('sweep-tx-1');
  });

  it('rechaza un webhook duplicado por eventKey y lo trata como idempotente', async () => {
    const orderId = await createOrder();
    const payload = {
      address: 'TDEPOSIT1234567890',
      label: `batm-001|cas-tx-123|${orderId}`,
      uniqID: `sell_${orderId}`,
      txid: 'deposit-tx-1',
      token: 'USDT',
      network: 'TRON',
      amount: 24.12,
      confirmations: 25,
      status: 'deposit_confirmed',
    };

    const first = await request(testApp.app.server).post('/api/v1/webhooks/cryptocurrencyapi').send(payload);
    const second = await request(testApp.app.server).post('/api/v1/webhooks/cryptocurrencyapi').send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);

    const transitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'DEPOSIT_DETECTED',
    }).exec();
    expect(transitions).toBe(1);
  });

  it('rechaza callback iTRX con firma invalida y persiste el evento', async () => {
    const orderId = await createOrder();
    const response = await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', String(Math.floor(Date.now() / 1000)))
      .set('signature', 'bad-signature')
      .send({
        receive_address: 'TDEPOSIT1234567890',
        out_trade_no: orderId,
        status: 40,
        type: 'energy',
        source: 'manual',
      });

    expect(response.status).toBe(401);
    const savedEvent = await ProviderEventModel.findOne({ provider: 'itrx' }).exec();
    expect(savedEvent).not.toBeNull();
    expect(savedEvent?.signatureValid).toBe(false);
  });

  it('no permite forward sin ENERGY_CONFIRMED', async () => {
    const orderId = await createOrder();
    const response = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/forward`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ENERGY_NOT_CONFIRMED');
  });

  it('marca FORWARD_ACCEPTED de inmediato y encola reconcile al aceptar el request async del forward', async () => {
    const orderId = await createOrder('cas-tx-forward-immediate-accept');
    const now = new Date();

    await OrderModel.updateOne(
      { orderId },
      {
        $set: {
          status: 'ENERGY_CONFIRMED',
          statusReason: 'Energia confirmada y lista para solicitar forward.',
          cryptoAmountReceived: 24.12,
          depositDetectedAt: now,
          energyRequestedAt: now,
          energyConfirmedAt: now,
        },
      },
    ).exec();

    await OutboxJobModel.deleteMany({ orderId, jobType: 'RECONCILE_ORDER' }).exec();

    await OutboxJobModel.create({
      jobType: 'RECONCILE_ORDER',
      orderId,
      payload: { reason: 'future-reconcile-placeholder' },
      status: 'PENDING',
      runAt: new Date(Date.now() + 60_000),
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      lockedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'forward-req-immediate-accept',
      });

    const response = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/forward`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(response.status).toBe(202);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('FORWARD_ACCEPTED');
    expect(order.providerForwardRequestId).toBe('forward-req-immediate-accept');

    const forwardRequest = await ForwardRequestModel.findOne({ orderId }).exec();
    expect(forwardRequest?.status).toBe('ACCEPTED');
    expect(forwardRequest?.providerRequestId).toBe('forward-req-immediate-accept');

    const pendingJobs = await OutboxJobModel.find({
      orderId,
      jobType: 'RECONCILE_ORDER',
      status: { $in: ['PENDING', 'RUNNING'] },
    }).exec();

    expect(pendingJobs).toHaveLength(1);
    expect(pendingJobs[0]?.runAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('no solicita energia dos veces si ya existe una activa', async () => {
    const orderId = await createOrder();

    await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-tx-123|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-tx-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 25,
        status: 'deposit_confirmed',
      });

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
        serial: 'collect-serial-no-double',
        scene: 0,
        amount: 65000,
        balance: 1000,
      });

    await testApp.services.scheduler.runTick();

    const response = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(response.status).toBe(202);
    expect(response.body.data.skipped).toBe(true);
  });

  it('envia a revision manual una solicitud de energia con timeout incierto', async () => {
    const orderId = await createOrder();

    await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-tx-123|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-tx-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 25,
        status: 'deposit_confirmed',
      });

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
      .replyWithError({ code: 'ECONNABORTED', message: 'timeout' });

    await testApp.services.scheduler.runTick();

    let order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ERROR_MANUAL_REVIEW');
    expect(order.manualReviewRequired).toBe(true);

    await OutboxJobModel.updateMany({ orderId, jobType: 'REQUEST_ENERGY' }, { runAt: new Date(0) }).exec();

    await testApp.services.scheduler.runTick();

    order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ERROR_MANUAL_REVIEW');

    const energyRequest = await EnergyRequestModel.findOne({ orderId }).sort({ createdAt: -1 }).exec();
    expect(energyRequest?.status).toBe('OUTCOME_UNKNOWN');
  });

  it('usa fallback fijo de iTRX en SELL sin quedar atascada en ENERGY_ESTIMATION_REQUESTED', async () => {
    const orderId = await createOrder('cas-sell-energy-fallback');

    await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-sell-energy-fallback|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-tx-fallback-sell',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 25,
        status: 'deposit_confirmed',
      });

    nock(testApp.config.providers.itrx.baseUrl)
      .get('/api/v1/frontend/order/price')
      .query(true)
      .replyWithError({ code: 'ECONNABORTED', message: 'timeout' });

    nock(testApp.config.providers.itrx.baseUrl)
      .post('/api/v1/frontend/order/collect-manual')
      .reply(200, {
        errno: 0,
        message: 'ok',
        serial: 'collect-serial-fallback',
        scene: 0,
        amount: 65000,
        balance: 1000,
      });

    const response = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(response.status).toBe(202);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ENERGY_REQUESTED');

    const energyRequest = await EnergyRequestModel.findOne({ orderId }).sort({ createdAt: -1 }).exec();
    expect(energyRequest?.mode).toBe('fixed');
    expect(energyRequest?.requestedEnergyAmount).toBe(testApp.config.energy.fixedAmount);
  });

  it('expira una orden sin deposito y marca late deposit si entra despues', async () => {
    const orderId = await createOrder();

    await OrderModel.updateOne(
      { orderId },
      {
        expiresAt: new Date(Date.now() - 60_000),
      },
    ).exec();

    await OutboxJobModel.updateMany({ orderId, jobType: 'EXPIRE_ORDER' }, { runAt: new Date(0) }).exec();

    mockTronGridTransfers('TDEPOSIT1234567890', []);

    await testApp.services.scheduler.runTick();

    let order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('EXPIRED');

    const lateDepositResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-tx-123|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-tx-late',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 25,
        status: 'deposit_confirmed',
      });

    expect(lateDepositResponse.status).toBe(200);
    order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('LATE_DEPOSIT');
  });

  it('expira una SELL localmente sin consultar evidencia remota durante EXPIRE_ORDER', async () => {
    const orderId = await createOrder('cas-tx-poll-expire');

    await OrderModel.updateOne(
      { orderId },
      {
        expiresAt: new Date(Date.now() - 60_000),
      },
    ).exec();

    await OutboxJobModel.updateMany(
      { orderId, jobType: 'EXPIRE_ORDER' },
      { runAt: new Date(0) },
    ).exec();

    const remoteDepositEvidence = mockTronGridTransfers('TDEPOSIT1234567890', [
      buildTronGridTransfer({
        txid: 'deposit-tx-poll-expire',
        to: 'TDEPOSIT1234567890',
        amount: '24120000',
      }),
    ]);

    await testApp.services.scheduler.runTick();

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('EXPIRED');
    expect(order.cryptoAmountReceived).toBeNull();
    expect(remoteDepositEvidence.isDone()).toBe(false);

    const depositTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'DEPOSIT_DETECTED',
    }).exec();
    expect(depositTransitions).toBe(0);
  });

  it('rescata un forward SELL remoto por polling cuando falta el webhook de CryptoCurrencyAPI', async () => {
    const orderId = await createOrder('cas-tx-poll-forward');
    const now = new Date();

    await OrderModel.updateOne(
      { orderId },
      {
        status: 'FORWARD_REQUESTED',
        statusReason: 'Forward solicitado y pendiente de webhook.',
        cryptoAmountReceived: 24.12,
        depositDetectedAt: now,
        energyRequestedAt: now,
        energyConfirmedAt: now,
        providerForwardRequestId: 'forward-req-poll',
      },
    ).exec();

    await ForwardRequestModel.create({
      orderId,
      provider: 'cryptocurrencyapi',
      fromAddress: 'TDEPOSIT1234567890',
      toAddress: testApp.config.tron.forwardTargetAddress,
      token: 'USDT',
      amount: 24.12,
      providerRequestId: 'forward-req-poll',
      providerResponseRaw: { result: 'forward-req-poll' },
      txid: null,
      status: 'REQUESTED',
      requestedAt: now,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.status')
      .query((query) => query['id'] === 'forward-req-poll')
      .reply(200, {
        result: {
          id: 'forward-req-poll',
          label: `forward|${orderId}`,
          uniqID: `forward_${orderId}`,
          token: 'USDT',
          state: '7',
          result: 'confirmed',
          txid: 'sweep-tx-poll',
          amount: '24.12',
          to: testApp.config.tron.forwardTargetAddress,
        },
      });

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('cryptocurrencyapi-status-query-forward');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('READY_FOR_PAYOUT');
    expect(order.providerForwardTxid).toBe('sweep-tx-poll');
  });

  it('confirma un forward SELL por blockchain cuando ya existe txid y no llega el webhook final', async () => {
    const orderId = await createOrder('cas-tx-forward-chain-confirm');
    const now = new Date();

    await OrderModel.updateOne(
      { orderId },
      {
        status: 'FORWARD_ACCEPTED',
        statusReason: 'Forward aceptado y pendiente de confirmacion final.',
        cryptoAmountReceived: 24.12,
        depositDetectedAt: now,
        energyRequestedAt: now,
        energyConfirmedAt: now,
        providerForwardRequestId: 'forward-req-chain-confirm',
        providerForwardTxid: null,
      },
    ).exec();

    await ForwardRequestModel.create({
      orderId,
      provider: 'cryptocurrencyapi',
      fromAddress: 'TDEPOSIT1234567890',
      toAddress: testApp.config.tron.forwardTargetAddress,
      token: 'USDT',
      amount: 24.12,
      providerRequestId: 'forward-req-chain-confirm',
      providerResponseRaw: { result: 'forward-req-chain-confirm' },
      txid: 'sweep-tx-chain-confirm',
      status: 'ACCEPTED',
      requestedAt: now,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    mockTronGridTransfers(testApp.config.tron.forwardTargetAddress, [
      buildTronGridTransfer({
        txid: 'sweep-tx-chain-confirm',
        from: 'TDEPOSIT1234567890',
        to: testApp.config.tron.forwardTargetAddress,
        amount: '24120000',
      }),
    ]);

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('cryptocurrencyapi-status-query-forward');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('READY_FOR_PAYOUT');
    expect(order.providerForwardTxid).toBe('sweep-tx-chain-confirm');

    const sweepTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'SWEEP_CONFIRMED',
    }).exec();
    const readyTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'READY_FOR_PAYOUT',
    }).exec();

    expect(sweepTransitions).toBe(1);
    expect(readyTransitions).toBe(1);
  });

  it('mantiene una SELL en progreso cuando la tx on-chain del forward no coincide con el sweep esperado', async () => {
    const orderId = await createOrder('cas-tx-forward-chain-mismatch');
    const now = new Date();

    await OrderModel.updateOne(
      { orderId },
      {
        status: 'FORWARD_ACCEPTED',
        statusReason: 'Forward aceptado y pendiente de confirmacion final.',
        cryptoAmountReceived: 24.12,
        depositDetectedAt: now,
        energyRequestedAt: now,
        energyConfirmedAt: now,
        providerForwardRequestId: 'forward-req-chain-mismatch',
      },
    ).exec();

    await ForwardRequestModel.create({
      orderId,
      provider: 'cryptocurrencyapi',
      fromAddress: 'TDEPOSIT1234567890',
      toAddress: testApp.config.tron.forwardTargetAddress,
      token: 'USDT',
      amount: 24.12,
      providerRequestId: 'forward-req-chain-mismatch',
      providerResponseRaw: { result: 'forward-req-chain-mismatch' },
      txid: 'sweep-tx-chain-mismatch',
      status: 'ACCEPTED',
      requestedAt: now,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    mockTronGridTransfers(testApp.config.tron.forwardTargetAddress, []);
    mockTronGridTransfers('TDEPOSIT1234567890', [
      buildTronGridTransfer({
        txid: 'sweep-tx-chain-mismatch',
        from: 'TDEPOSIT1234567890',
        to: 'TWRONGCENTRALWALLET1234567890',
        amount: '24120000',
      }),
    ]);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.status')
      .query((query) => query['id'] === 'forward-req-chain-mismatch')
      .reply(200, {
        result: {
          id: 'forward-req-chain-mismatch',
          label: `forward|${orderId}`,
          uniqID: `forward_${orderId}`,
          token: 'USDT',
          state: '2',
          result: 'broadcasted',
          txid: 'sweep-tx-chain-mismatch',
          amount: '24.12',
          to: testApp.config.tron.forwardTargetAddress,
        },
      });

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('FORWARD_ACCEPTED');

    const readyTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'READY_FOR_PAYOUT',
    }).exec();
    expect(readyTransitions).toBe(0);
  });

  it('cierra una SELL en COMPLETED cuando CAS confirma el payout final', async () => {
    const orderId = await createOrder('cas-sell-complete-1');

    await OrderModel.updateOne(
      { orderId },
      {
        status: 'READY_FOR_PAYOUT',
        statusReason: 'Lista para payout en CAS',
        cryptoAmountReceived: 24.12,
        cashPayoutEligibleAt: new Date(),
        settlementCompletedAt: new Date(),
      },
    ).exec();

    const response = await request(testApp.app.server)
      .post(`/api/v1/cas/sell-orders/${orderId}/complete-payout`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        casTransactionId: 'cas-sell-complete-1',
        terminalId: 'batm-001',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('COMPLETED');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('COMPLETED');
    expect(order.completedAt).not.toBeNull();

    const transitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'COMPLETED',
      'metadata.source': 'cas-payout-complete',
    }).exec();
    expect(transitions).toBe(1);
  });

  it('no reencola reconcile para una orden terminal', async () => {
    const orderId = await createOrder('cas-terminal-no-poll');

    await OrderModel.updateOne(
      { orderId },
      {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    ).exec();

    await OutboxJobModel.deleteMany({ orderId, jobType: 'RECONCILE_ORDER' }).exec();

    await testApp.services.reconciliationService.scheduleReconciliationIfNeeded(orderId);

    const pendingJobs = await OutboxJobModel.countDocuments({
      orderId,
      jobType: 'RECONCILE_ORDER',
      status: { $in: ['PENDING', 'RUNNING'] },
    }).exec();

    expect(pendingJobs).toBe(0);
  });

  it('trata como idempotente la confirmacion final de payout SELL', async () => {
    const orderId = await createOrder('cas-sell-complete-2');

    await OrderModel.updateOne(
      { orderId },
      {
        status: 'READY_FOR_PAYOUT',
        statusReason: 'Lista para payout en CAS',
        cryptoAmountReceived: 24.12,
        cashPayoutEligibleAt: new Date(),
        settlementCompletedAt: new Date(),
      },
    ).exec();

    const first = await request(testApp.app.server)
      .post(`/api/v1/cas/sell-orders/${orderId}/complete-payout`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        casTransactionId: 'cas-sell-complete-2',
        terminalId: 'batm-001',
      });

    const second = await request(testApp.app.server)
      .post(`/api/v1/cas/sell-orders/${orderId}/complete-payout`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        casTransactionId: 'cas-sell-complete-2',
        terminalId: 'batm-001',
      });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const transitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'COMPLETED',
    }).exec();
    expect(transitions).toBe(1);
  });

  it('rechaza completar una SELL con correlacion CAS inconsistente', async () => {
    const orderId = await createOrder('cas-sell-complete-3');

    await OrderModel.updateOne(
      { orderId },
      {
        status: 'READY_FOR_PAYOUT',
        statusReason: 'Lista para payout en CAS',
        cryptoAmountReceived: 24.12,
        cashPayoutEligibleAt: new Date(),
        settlementCompletedAt: new Date(),
      },
    ).exec();

    const response = await request(testApp.app.server)
      .post(`/api/v1/cas/sell-orders/${orderId}/complete-payout`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send({
        casTransactionId: 'cas-sell-wrong',
        terminalId: 'batm-001',
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('READY_FOR_PAYOUT');
  });

  it('crea una orden BUY y persiste sender/destino', async () => {
    const orderId = await createBuyOrder();
    const order = await testApp.services.ordersService.getInternalOrder(orderId);

    expect(order.type).toBe('BUY');
    expect(order.status).toBe('CREATED');
    expect(order.customerDestinationAddress).toBe('TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ');
    expect(order.buySenderAddress).toBe(testApp.config.tron.buySenderAddress);
  });

  it('procesa BUY desde energia hasta envio confirmado', async () => {
    const orderId = await createBuyOrder();

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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    const requestEnergyResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(requestEnergyResponse.status).toBe(202);

    let order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ENERGY_REQUESTED');

    const itrxPayload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-1',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-1',
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      itrxPayload,
    );

    const itrxResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(itrxPayload);

    expect(itrxResponse.status).toBe(200);

    order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ENERGY_CONFIRMED');

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'send-req-1',
      });

    const sendResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(sendResponse.status).toBe(202);

    order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('SEND_ACCEPTED');

    const sendWebhookResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        requestId: 'send-req-1',
        uniqID: `send_${orderId}`,
        label: `send|${orderId}`,
        txid: 'send-tx-1',
        status: 'send_confirmed',
      });

    expect(sendWebhookResponse.status).toBe(200);

    order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('COMPLETED');
    expect(order.providerSendTxid).toBe('send-tx-1');
  });

  it('rechaza send BUY sin energia confirmada', async () => {
    const orderId = await createBuyOrder();

    const response = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ENERGY_NOT_CONFIRMED');
  });

  it('no permite doble send BUY si ya existe una solicitud activa', async () => {
    const orderId = await createBuyOrder();

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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-2',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-2',
    };
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'send-req-2',
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const secondResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(secondResponse.status).toBe(202);
    expect(secondResponse.body.data.skipped).toBe(true);
  });

  it('envia a revision manual un envio BUY con timeout incierto', async () => {
    const orderId = await createBuyOrder();

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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-3',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-3',
    };
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .replyWithError({ code: 'ECONNABORTED', message: 'timeout' });

    await testApp.services.scheduler.runTick();

    let order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ERROR_MANUAL_REVIEW');
    expect(order.manualReviewRequired).toBe(true);

    await OutboxJobModel.updateMany({ orderId, jobType: 'SEND_BUY' }, { runAt: new Date(0) }).exec();

    await testApp.services.scheduler.runTick();

    order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ERROR_MANUAL_REVIEW');

    const sendRequest = await SendRequestModel.findOne({ orderId }).sort({ createdAt: -1 }).exec();
    expect(sendRequest?.status).toBe('OUTCOME_UNKNOWN');
  });

  it('usa fallback fijo de iTRX en BUY sin quedar atascada en ENERGY_ESTIMATION_REQUESTED', async () => {
    const orderId = await createBuyOrder(24.12);
    const previousAllowFallback = testApp.config.energyBuy.allowFixedFallback;
    testApp.config.energyBuy.allowFixedFallback = true;

    try {
      nock(testApp.config.providers.itrx.baseUrl)
        .get('/api/v1/frontend/order/price')
        .query(true)
        .replyWithError({ code: 'ECONNABORTED', message: 'timeout' });

      nock(testApp.config.providers.itrx.baseUrl)
        .post('/api/v1/frontend/order')
        .reply(200, {
          errno: 0,
          message: 'ok',
          serial: 'itrx-buy-one-off',
          amount: 70000,
          balance: 1000,
        });

      const response = await request(testApp.app.server)
        .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
        .set('x-api-key', testApp.config.apiKeys.internal)
        .send();

      expect(response.status).toBe(202);

      const order = await testApp.services.ordersService.getInternalOrder(orderId);
      expect(order.status).toBe('ENERGY_REQUESTED');

      const energyRequest = await EnergyRequestModel.findOne({ orderId }).sort({ createdAt: -1 }).exec();
      expect(energyRequest?.mode).toBe('fixed');
      expect(energyRequest?.requestedEnergyAmount).toBe(testApp.config.energyBuy.fixedAmount);
    } finally {
      testApp.config.energyBuy.allowFixedFallback = previousAllowFallback;
    }
  });

  it('permite cancelar BUY antes de solicitar el envio', async () => {
    const orderId = await createBuyOrder();

    const response = await request(testApp.app.server)
      .post(`/api/v1/cas/buy-orders/${orderId}/cancel`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send();

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('CANCELED');
  });

  it('rechaza cancelar BUY si el envio ya fue solicitado', async () => {
    const orderId = await createBuyOrder();

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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-4',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-4',
    };
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'send-req-4',
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const response = await request(testApp.app.server)
      .post(`/api/v1/cas/buy-orders/${orderId}/cancel`)
      .set('x-api-key', testApp.config.apiKeys.cas)
      .send();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('marca BUY en revision manual si el monto esta por debajo del minimo operativo', async () => {
    const orderId = await createBuyOrder(0.5);

    const response = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(response.status).toBe(422);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ERROR_MANUAL_REVIEW');
    expect(order.manualReviewRequired).toBe(true);
  });

  it('no cierra una orden BUY cuando el estado externo solo indica processing/broadcasted', async () => {
    const orderId = await createBuyOrder();

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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-pending',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-pending',
    };
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'send-req-pending',
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const webhookResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        requestId: 'send-req-pending',
        uniqID: `send_${orderId}`,
        label: `send|${orderId}`,
        txid: 'send-tx-pending',
        status: 'processing',
      });

    expect(webhookResponse.status).toBe(200);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('SEND_BROADCASTED');

    const completedTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'COMPLETED',
    }).exec();
    expect(completedTransitions).toBe(0);
  });

  it('encola reconciliacion inmediata al recibir un send BUY broadcasted con txid', async () => {
    const orderId = await createBuyOrder();

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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-immediate-reconcile',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-immediate-reconcile',
    };
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'send-req-immediate-reconcile',
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    await OutboxJobModel.deleteMany({ orderId, jobType: 'RECONCILE_ORDER' }).exec();

    const webhookResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        requestId: 'send-req-immediate-reconcile',
        uniqID: `send_${orderId}`,
        label: `send|${orderId}`,
        txid: 'send-tx-immediate-reconcile',
        status: 'processing',
      });

    expect(webhookResponse.status).toBe(200);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('SEND_BROADCASTED');
    expect(order.sendBroadcastedAt).toBeTruthy();

    const pendingJobs = await OutboxJobModel.find({
      orderId,
      jobType: 'RECONCILE_ORDER',
      status: { $in: ['PENDING', 'RUNNING'] },
    }).exec();

    expect(pendingJobs).toHaveLength(1);
    expect(pendingJobs[0]?.payload['reason']).toBe('immediate_reconcile_on_broadcast');
    expect(pendingJobs[0]?.runAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('rechaza correlacionar un webhook por label no seguro o ambiguo', async () => {
    const firstOrderId = await createOrder('cas-tx-amb-1');
    const secondOrderId = await createOrder('cas-tx-amb-2');

    await OrderModel.updateMany(
      { orderId: { $in: [firstOrderId, secondOrderId] } },
      {
        providerLabel: 'shared-label',
      },
    ).exec();

    const response = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        label: 'shared-label',
        status: 'deposit_confirmed',
      });

    expect(response.status).toBe(404);

    const firstOrder = await testApp.services.ordersService.getInternalOrder(firstOrderId);
    const secondOrder = await testApp.services.ordersService.getInternalOrder(secondOrderId);
    expect(firstOrder.status).toBe('WAITING_DEPOSIT');
    expect(secondOrder.status).toBe('WAITING_DEPOSIT');
  });

  it('reconcilia energia SELL por Collection order/query cuando falta el callback', async () => {
    const orderId = await createOrder();

    await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-tx-123|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-tx-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 25,
        status: 'deposit_confirmed',
      });

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
        serial: 'collect-serial-reconcile',
        scene: 0,
        amount: 65000,
        balance: 1000,
      });

    await testApp.services.scheduler.runTick();

    nock(testApp.config.providers.itrx.baseUrl)
      .get('/api/v1/frontend/order/query')
      .query((query) => query['serial'] === 'collect-serial-reconcile')
      .reply(200, {
        errno: 0,
        order_no: 'collect-serial-reconcile',
        out_trade_no: orderId,
        receive_address: 'TDEPOSIT1234567890',
        energy_amount: 65000,
        pay_amount: 100000,
        amount: 65000,
        status: 40,
      });

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('itrx-order-query');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ENERGY_CONFIRMED');
  });

  it('mantiene la energia SELL en progreso cuando Collection order/query devuelve un estado intermedio', async () => {
    const orderId = await createOrder('cas-sell-energy-pending-query');

    await OrderModel.updateOne(
      { orderId },
      {
        status: 'ENERGY_REQUESTED',
        cryptoAmountReceived: 24.12,
        depositDetectedAt: new Date(),
      },
    ).exec();

    await EnergyRequestModel.create({
      orderId,
      provider: 'itrx',
      mode: 'estimated',
      energyContext: 'SELL_DEPOSIT',
      estimatedEnergyAmount: 70000,
      requestedEnergyAmount: 84000,
      safetyMultiplier: 1.2,
      period: '1H',
      receiveAddress: 'TDEPOSIT1234567890',
      callbackUrl: `${testApp.config.apiBaseUrl}/api/v1/webhooks/itrx`,
      providerRequestRaw: { out_trade_no: orderId },
      providerResponseRaw: null,
      providerSerial: 'itrx-pending-serial-1',
      status: 'REQUESTED',
      signatureValid: null,
      confirmedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    nock(testApp.config.providers.itrx.baseUrl)
      .get('/api/v1/frontend/order/query')
      .query((query) => query['serial'] === 'itrx-pending-serial-1')
      .reply(200, {
        errno: 0,
        order_no: 'itrx-pending-serial-1',
        out_trade_no: orderId,
        receive_address: 'TDEPOSIT1234567890',
        energy_amount: 65000,
        pay_amount: 100000,
        amount: 65000,
        status: 30,
      });

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('itrx-order-query');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ENERGY_REQUESTED');

    const confirmedTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'ENERGY_CONFIRMED',
    }).exec();
    expect(confirmedTransitions).toBe(0);
  });

  it('no confirma energia SELL cuando Collection order/query devuelve errno distinto de 0', async () => {
    const orderId = await createOrder('cas-sell-energy-errno-query');

    await OrderModel.updateOne(
      { orderId },
      {
        status: 'ENERGY_REQUESTED',
        cryptoAmountReceived: 24.12,
        depositDetectedAt: new Date(),
      },
    ).exec();

    await EnergyRequestModel.create({
      orderId,
      provider: 'itrx',
      mode: 'estimated',
      energyContext: 'SELL_DEPOSIT',
      estimatedEnergyAmount: 70000,
      requestedEnergyAmount: 84000,
      safetyMultiplier: 1.2,
      period: '1H',
      receiveAddress: 'TDEPOSIT1234567890',
      callbackUrl: `${testApp.config.apiBaseUrl}/api/v1/webhooks/itrx`,
      providerRequestRaw: { out_trade_no: orderId },
      providerResponseRaw: null,
      providerSerial: 'itrx-errno-serial-1',
      status: 'REQUESTED',
      signatureValid: null,
      confirmedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    nock(testApp.config.providers.itrx.baseUrl)
      .get('/api/v1/frontend/order/query')
      .query((query) => query['serial'] === 'itrx-errno-serial-1')
      .reply(200, {
        errno: 404,
        message: 'order not found',
      });

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ENERGY_REQUESTED');

    const confirmedTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'ENERGY_CONFIRMED',
    }).exec();
    expect(confirmedTransitions).toBe(0);
  });

  it('no confirma energia cuando el callback iTRX viene con payload inconsistente', async () => {
    const orderId = await createOrder('cas-sell-energy-invalid-callback');

    await OrderModel.updateOne(
      { orderId },
      {
        status: 'ENERGY_REQUESTED',
        cryptoAmountReceived: 24.12,
        depositDetectedAt: new Date(),
      },
    ).exec();

    await EnergyRequestModel.create({
      orderId,
      provider: 'itrx',
      mode: 'estimated',
      energyContext: 'SELL_DEPOSIT',
      estimatedEnergyAmount: 70000,
      requestedEnergyAmount: 84000,
      safetyMultiplier: 1.2,
      period: '1H',
      receiveAddress: 'TDEPOSIT1234567890',
      callbackUrl: `${testApp.config.apiBaseUrl}/api/v1/webhooks/itrx`,
      providerRequestRaw: { out_trade_no: orderId },
      providerResponseRaw: null,
      providerSerial: 'itrx-invalid-callback-1',
      status: 'REQUESTED',
      signatureValid: null,
      confirmedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const payload = {
      receive_address: 'TDEPOSIT1234567890',
      out_trade_no: orderId,
      serial: 'itrx-invalid-callback-1',
      energy_amount: 84000,
      pay_amount: 100000,
      type: 'energy',
      source: 'manual',
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    const response = await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);

    expect(response.status).toBe(200);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ENERGY_REQUESTED');

    const confirmedTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'ENERGY_CONFIRMED',
    }).exec();
    expect(confirmedTransitions).toBe(0);
  });

  it('reconcilia envio BUY por .status cuando falta el webhook de CryptoCurrencyAPI', async () => {
    const orderId = await createBuyOrder();

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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-reconcile',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-reconcile',
    };
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'send-req-reconcile',
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.status')
      .query((query) => query['id'] === 'send-req-reconcile')
      .reply(200, {
        result: {
          id: 'send-req-reconcile',
          label: `send|${orderId}`,
          token: 'USDT',
          state: '7',
          result: 'confirmed',
          txid: 'send-tx-reconcile',
        },
      });

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('cryptocurrencyapi-status-query-send');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('COMPLETED');
    expect(order.providerSendTxid).toBe('send-tx-reconcile');

    const webhookResponse = await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        requestId: 'send-req-reconcile',
        uniqID: `send_${orderId}`,
        label: `send|${orderId}`,
        txid: 'send-tx-reconcile',
        status: 'send_confirmed',
      });

    expect(webhookResponse.status).toBe(200);

    const completedTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'COMPLETED',
    }).exec();
    expect(completedTransitions).toBe(1);
  });

  it('reconcilia envio BUY por .status en estado broadcasted sin marcar completion final', async () => {
    const orderId = await createBuyOrder();

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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-broadcast',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-broadcast',
    };
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'send-req-broadcast-reconcile',
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.status')
      .query((query) => query['id'] === 'send-req-broadcast-reconcile')
      .reply(200, {
        result: {
          id: 'send-req-broadcast-reconcile',
          label: `send|${orderId}`,
          token: 'USDT',
          state: '2',
          result: 'broadcasted',
          txid: 'send-tx-broadcast-reconcile',
        },
      });

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);
    expect(reconcileResponse.body.data.actions).toContain('cryptocurrencyapi-status-query-send');

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('SEND_BROADCASTED');

    const completedTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'COMPLETED',
    }).exec();
    expect(completedTransitions).toBe(0);
  });

  it('completa una BUY por confirmacion on-chain cuando ya existe sendTxid y no llega el webhook final', async () => {
    const orderId = await createBuyOrder();

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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-chain-confirm',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-chain-confirm',
    };
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'send-req-chain-confirm',
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        requestId: 'send-req-chain-confirm',
        uniqID: `send_${orderId}`,
        label: `send|${orderId}`,
        txid: 'send-tx-chain-confirm',
        status: 'processing',
      });

    const broadcastedOrder = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(broadcastedOrder.status).toBe('SEND_BROADCASTED');
    expect(broadcastedOrder.providerSendTxid).toBe('send-tx-chain-confirm');

    mockTronGridTransactionEvents('send-tx-chain-confirm', [
      buildTronGridTransactionEvent({
        txid: 'send-tx-chain-confirm',
        from: testApp.config.tron.buySenderAddress,
        to: 'TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ',
        amount: '24120000',
        blockNumber: 2_000,
      }),
    ]);
    mockTronGridLatestBlock(2_000);

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('COMPLETED');
    expect(order.providerSendTxid).toBe('send-tx-chain-confirm');

    const deliveryTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'DELIVERY_CONFIRMED',
    }).exec();
    const completedTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'COMPLETED',
    }).exec();

    expect(deliveryTransitions).toBe(1);
    expect(completedTransitions).toBe(1);
  });

  it('mantiene una BUY en progreso cuando la tx on-chain no coincide con el destino esperado', async () => {
    const orderId = await createBuyOrder();

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
        serial: 'itrx-buy-one-off',
        amount: 70000,
        balance: 1000,
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/request-buy-energy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      receive_address: testApp.config.tron.buySenderAddress,
      out_trade_no: orderId,
      serial: 'itrx-buy-serial-chain-mismatch',
      energy_amount: 84000,
      pay_amount: 100000,
      status: 40,
      type: 'delegate_success',
      txid: 'itrx-buy-chain-tx-chain-mismatch',
    };
    const signature = buildItrxSignature(
      testApp.config.providers.itrx.apiSecret,
      timestamp,
      payload,
    );

    await request(testApp.app.server)
      .post('/api/v1/webhooks/itrx')
      .set('timestamp', timestamp)
      .set('signature', signature)
      .send(payload);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.send')
      .query(true)
      .reply(200, {
        result: 'send-req-chain-mismatch',
      });

    await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/send-buy`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        requestId: 'send-req-chain-mismatch',
        uniqID: `send_${orderId}`,
        label: `send|${orderId}`,
        txid: 'send-tx-chain-mismatch',
        status: 'processing',
      });

    mockTronGridTransactionEvents('send-tx-chain-mismatch', [
      buildTronGridTransactionEvent({
        txid: 'send-tx-chain-mismatch',
        from: testApp.config.tron.buySenderAddress,
        to: 'TWRONGDESTINATION1234567890',
        amount: '24120000',
        blockNumber: 2_100,
      }),
    ]);
    mockTronGridLatestBlock(2_100);

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.status')
      .query((query) => query['id'] === 'send-req-chain-mismatch')
      .reply(200, {
        result: {
          id: 'send-req-chain-mismatch',
          label: `send|${orderId}`,
          token: 'USDT',
          state: '2',
          result: 'broadcasted',
          txid: 'send-tx-chain-mismatch',
        },
      });

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('SEND_BROADCASTED');

    const completedTransitions = await OrderStateTransitionModel.countDocuments({
      orderId,
      toStatus: 'COMPLETED',
    }).exec();
    expect(completedTransitions).toBe(0);
  });

  it('acepta una pequena diferencia de monto BUY dentro de la tolerancia configurada', async () => {
    const orderId = await createBuyOrder();

    await prepareBuyOrderForSend(orderId, {
      serial: 'itrx-buy-serial-tolerance',
      txid: 'itrx-buy-chain-tx-tolerance',
    });
    await requestBuySend(orderId, 'send-req-tolerance');
    await markBuyOrderAsBroadcasted(orderId, {
      requestId: 'send-req-tolerance',
      txid: 'send-tx-tolerance',
    });

    mockTronGridTransactionEvents('send-tx-tolerance', [
      buildTronGridTransactionEvent({
        txid: 'send-tx-tolerance',
        from: testApp.config.tron.buySenderAddress,
        to: 'TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ',
        amount: '24120001',
        blockNumber: 2_200,
      }),
    ]);
    mockTronGridLatestBlock(2_200);

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('COMPLETED');
  });

  it('completa una BUY aunque el sender on-chain difiera cuando la validacion estricta esta deshabilitada', async () => {
    const orderId = await createBuyOrder();

    await prepareBuyOrderForSend(orderId, {
      serial: 'itrx-buy-serial-sender-warning',
      txid: 'itrx-buy-chain-tx-sender-warning',
    });
    await requestBuySend(orderId, 'send-req-sender-warning');
    await markBuyOrderAsBroadcasted(orderId, {
      requestId: 'send-req-sender-warning',
      txid: 'send-tx-sender-warning',
    });

    mockTronGridTransactionEvents('send-tx-sender-warning', [
      buildTronGridTransactionEvent({
        txid: 'send-tx-sender-warning',
        from: 'TDIFFERENTSENDER1234567890',
        to: 'TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ',
        amount: '24120000',
        blockNumber: 2_300,
      }),
    ]);
    mockTronGridLatestBlock(2_300);

    const reconcileResponse = await request(testApp.app.server)
      .post(`/api/v1/internal/orders/${orderId}/reconcile`)
      .set('x-api-key', testApp.config.apiKeys.internal)
      .send();

    expect(reconcileResponse.status).toBe(202);

    const order = await testApp.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('COMPLETED');
  });

  it('no completa una BUY con sender distinto cuando la validacion estricta esta habilitada', async () => {
    const previousStrictSenderMatch = testApp.config.buy.requireExactSenderMatch;
    testApp.config.buy.requireExactSenderMatch = true;

    try {
      const orderId = await createBuyOrder();

      await prepareBuyOrderForSend(orderId, {
        serial: 'itrx-buy-serial-sender-strict',
        txid: 'itrx-buy-chain-tx-sender-strict',
      });
      await requestBuySend(orderId, 'send-req-sender-strict');
      await markBuyOrderAsBroadcasted(orderId, {
        requestId: 'send-req-sender-strict',
        txid: 'send-tx-sender-strict',
      });

      mockTronGridTransactionEvents('send-tx-sender-strict', [
        buildTronGridTransactionEvent({
          txid: 'send-tx-sender-strict',
          from: 'TDIFFERENTSENDER1234567890',
          to: 'TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ',
          amount: '24120000',
          blockNumber: 2_400,
        }),
      ]);
      mockTronGridLatestBlock(2_400);

      nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
        .get('/api/trx/.status')
        .query((query) => query['id'] === 'send-req-sender-strict')
        .reply(200, {
          result: {
            id: 'send-req-sender-strict',
            label: `send|${orderId}`,
            token: 'USDT',
            state: '7',
            result: 'confirmed',
            txid: 'send-tx-sender-strict',
          },
        });

      const reconcileResponse = await request(testApp.app.server)
        .post(`/api/v1/internal/orders/${orderId}/reconcile`)
        .set('x-api-key', testApp.config.apiKeys.internal)
        .send();

      expect(reconcileResponse.status).toBe(202);

      const order = await testApp.services.ordersService.getInternalOrder(orderId);
      expect(order.status).toBe('SEND_BROADCASTED');
    } finally {
      testApp.config.buy.requireExactSenderMatch = previousStrictSenderMatch;
    }
  });

  it('manda una BUY broadcasted a manual review cuando supera el timeout configurable', async () => {
    const previousTimeout = testApp.config.buy.broadcastedTimeoutMinutes;
    testApp.config.buy.broadcastedTimeoutMinutes = 1;

    try {
      const orderId = await createBuyOrder();

      await prepareBuyOrderForSend(orderId, {
        serial: 'itrx-buy-serial-timeout-review',
        txid: 'itrx-buy-chain-tx-timeout-review',
      });
      await requestBuySend(orderId, 'send-req-timeout-review');
      await markBuyOrderAsBroadcasted(orderId, {
        requestId: 'send-req-timeout-review',
        txid: 'send-tx-timeout-review',
      });

      await OrderModel.updateOne(
        { orderId },
        {
          $set: {
            sendBroadcastedAt: new Date(Date.now() - 5 * 60_000),
            updatedAt: new Date(),
          },
        },
        {
          timestamps: false,
        },
      ).exec();

      mockTronGridTransactionEvents('send-tx-timeout-review', []);

      nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
        .get('/api/trx/.status')
        .query((query) => query['id'] === 'send-req-timeout-review')
        .reply(200, {
          result: {
            id: 'send-req-timeout-review',
            label: `send|${orderId}`,
            token: 'USDT',
            state: '2',
            result: 'broadcasted',
            txid: 'send-tx-timeout-review',
          },
        });

      const reconcileResponse = await request(testApp.app.server)
        .post(`/api/v1/internal/orders/${orderId}/reconcile`)
        .set('x-api-key', testApp.config.apiKeys.internal)
        .send();

      expect(reconcileResponse.status).toBe(202);

      const order = await testApp.services.ordersService.getInternalOrder(orderId);
      expect(order.status).toBe('ERROR_MANUAL_REVIEW');
      expect(order.manualReviewRequired).toBe(true);
      expect(order.sendBroadcastedAt).toBeTruthy();
    } finally {
      testApp.config.buy.broadcastedTimeoutMinutes = previousTimeout;
    }
  });
});
