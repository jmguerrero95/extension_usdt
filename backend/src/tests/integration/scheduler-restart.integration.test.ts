import nock from 'nock';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';

import { bootstrapApplication } from '../../app/bootstrap';
import { OrderModel } from '../../infrastructure/db/models/order.model';
import { OutboxJobModel } from '../../infrastructure/db/models/outbox-job.model';
import { ProviderEventModel } from '../../infrastructure/db/models/provider-event.model';
import { clearDatabase, closeTestApp, createTestApp } from '../test-helpers';

describe('scheduler restart integration', () => {
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

  const restorePrimaryApp = async () => {
    const reopened = await bootstrapApplication({
      config: testApp.config,
      logger: pino({ level: 'silent' }),
      startScheduler: false,
    });

    await reopened.app.ready();
    testApp = {
      ...testApp,
      ...reopened,
    };
  };

  const buildLegacySellOrder = (index: number) => {
    const createdAt = new Date('2024-01-01T00:00:00.000Z');
    const expiresAt = new Date('2024-01-01T00:20:00.000Z');

    return {
      orderId: `ord_legacy_${index.toString().padStart(4, '0')}`,
      externalRef: `legacy-ref-${index}`,
      terminalId: 'batm-001',
      type: 'SELL',
      asset: 'USDT',
      network: 'TRON',
      fiatCurrency: 'COP',
      fiatAmount: 100000,
      cryptoAmountExpected: 24.12,
      cryptoAmountReceived: null,
      cryptoAmountToSend: null,
      depositAddress: `TLEGACY${index.toString().padStart(24, '0')}`,
      depositAddressPublicKey: `PUB-${index}`,
      depositAddressPrivateKeyStored: false,
      depositAddressPrivateKeyEncrypted: null,
      customerDestinationAddress: null,
      buySenderAddress: null,
      providerUniqId: `sell_ord_legacy_${index.toString().padStart(4, '0')}`,
      providerLabel: `batm-001|legacy-ref-${index}|ord_legacy_${index.toString().padStart(4, '0')}`,
      providerGiveRequestRaw: null,
      providerForwardRequestId: null,
      providerForwardTxid: null,
      providerSendRequestId: null,
      providerSendTxid: null,
      forwardTargetAddress: testApp.config.tron.forwardTargetAddress,
      status: 'WAITING_DEPOSIT',
      statusReason: 'Orden heredada abierta',
      expiresAt,
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
      createdAt,
      updatedAt: createdAt,
    };
  };

  it('congela jobs pendientes despues de reiniciar la app y requiere revision manual', async () => {
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
        externalRef: 'cas-restart-1',
        terminalId: 'batm-001',
      });

    const orderId = (createResponse.body as { data: { orderId: string } }).data.orderId;

    await request(testApp.app.server)
      .post('/api/v1/webhooks/cryptocurrencyapi')
      .send({
        address: 'TDEPOSIT1234567890',
        label: `batm-001|cas-restart-1|${orderId}`,
        uniqID: `sell_${orderId}`,
        txid: 'deposit-tx-1',
        token: 'USDT',
        network: 'TRON',
        amount: 24.12,
        confirmations: 25,
        status: 'deposit_confirmed',
      });

    await testApp.app.close();

    const previousEnabled = testApp.config.scheduler.enabled;
    const previousPollMs = testApp.config.scheduler.pollMs;
    testApp.config.scheduler.enabled = true;
    testApp.config.scheduler.pollMs = 10_000;

    const restarted = await bootstrapApplication({
      config: testApp.config,
      logger: pino({ level: 'silent' }),
      startScheduler: true,
    });

    await restarted.app.ready();

    await restarted.services.scheduler.runTick();

    const order = await restarted.services.ordersService.getInternalOrder(orderId);
    expect(order.status).toBe('ERROR_MANUAL_REVIEW');
    expect(order.manualReviewRequired).toBe(true);

    const persistedOrder = await OrderModel.findOne({ orderId }).exec();
    expect(persistedOrder?.status).toBe('ERROR_MANUAL_REVIEW');

    const activeJobs = await OutboxJobModel.countDocuments({
      orderId,
      status: { $in: ['PENDING', 'RUNNING'] },
    }).exec();
    expect(activeJobs).toBe(0);
    expect(nock.pendingMocks()).toEqual([]);

    await restarted.app.close();
    testApp.config.scheduler.enabled = previousEnabled;
    testApp.config.scheduler.pollMs = previousPollMs;
    await restorePrimaryApp();
  });

  it('cuarentena mas de 500 ordenes antiguas de forma idempotente y no reencola eventos viejos', async () => {
    const legacyOrders = Array.from({ length: 1201 }, (_, index) => buildLegacySellOrder(index + 1));
    await OrderModel.insertMany(legacyOrders);
    await OrderModel.create({
      ...buildLegacySellOrder(5000),
      orderId: 'ord_legacy_terminal',
      externalRef: 'legacy-terminal',
      providerUniqId: 'sell_ord_legacy_terminal',
      providerLabel: 'batm-001|legacy-terminal|ord_legacy_terminal',
      status: 'COMPLETED',
      statusReason: 'Orden terminal historica',
      completedAt: new Date('2024-01-01T00:10:00.000Z'),
    });

    await OutboxJobModel.insertMany([
      {
        jobType: 'RECONCILE_ORDER',
        orderId: legacyOrders[0]?.orderId ?? null,
        payload: { jobId: 'legacy-pending-job' },
        status: 'PENDING',
        runAt: new Date('2024-01-01T00:00:00.000Z'),
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
      {
        jobType: 'REQUEST_ENERGY',
        orderId: legacyOrders[1]?.orderId ?? null,
        payload: { jobId: 'legacy-running-job' },
        status: 'RUNNING',
        runAt: new Date('2024-01-01T00:00:00.000Z'),
        attempts: 1,
        maxAttempts: 5,
        lastError: null,
        lockedAt: new Date('2024-01-01T00:00:00.000Z'),
        lockedBy: 'legacy-worker',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    ]);

    await ProviderEventModel.create({
      provider: 'cryptocurrencyapi',
      eventType: 'deposit',
      eventKey: 'legacy-event-unprocessed',
      orderId: legacyOrders[0]?.orderId ?? null,
      headers: {},
      payload: { legacy: true },
      rawBody: null,
      signatureValid: null,
      processed: false,
      processedAt: null,
      error: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    await testApp.app.close();

    const previousEnabled = testApp.config.scheduler.enabled;
    const previousPollMs = testApp.config.scheduler.pollMs;
    testApp.config.scheduler.enabled = true;
    testApp.config.scheduler.pollMs = 10_000;

    const restarted = await bootstrapApplication({
      config: testApp.config,
      logger: pino({ level: 'silent' }),
      startScheduler: true,
    });

    await restarted.app.ready();
    await restarted.services.scheduler.runTick();

    const quarantinedCount = await OrderModel.countDocuments({
      orderId: { $regex: '^ord_legacy_' },
      status: 'ERROR_MANUAL_REVIEW',
      manualReviewRequired: true,
      manualReviewCode: 'SERVER_RESTART_REQUIRES_REVIEW',
    }).exec();
    const remainingLegacyOpenOrders = await OrderModel.find({
      orderId: { $regex: '^ord_legacy_' },
      status: {
        $nin: ['COMPLETED', 'EXPIRED', 'CANCELED', 'LATE_DEPOSIT', 'ERROR_MANUAL_REVIEW'],
      },
    })
      .select({ orderId: 1, status: 1, manualReviewRequired: 1, manualReviewCode: 1 })
      .lean()
      .exec();
    expect(remainingLegacyOpenOrders).toEqual([]);
    expect(quarantinedCount).toBe(1201);

    const interruptedJobs = await OutboxJobModel.countDocuments({
      status: 'INTERRUPTED',
      interruptionReason: 'SERVER_RESTART_REQUIRES_MANUAL_REVIEW',
    }).exec();
    expect(interruptedJobs).toBe(2);

    const reprocessJobs = await OutboxJobModel.countDocuments({
      providerEventId: { $ne: null },
      status: { $in: ['PENDING', 'RUNNING'] },
    }).exec();
    expect(reprocessJobs).toBe(0);
    const terminalOrder = await OrderModel.findOne({ orderId: 'ord_legacy_terminal' }).lean().exec();
    expect(terminalOrder?.status).toBe('COMPLETED');
    expect(terminalOrder?.manualReviewRequired).toBe(false);
    expect(nock.pendingMocks()).toEqual([]);

    await restarted.app.close();

    const restartedAgain = await bootstrapApplication({
      config: testApp.config,
      logger: pino({ level: 'silent' }),
      startScheduler: true,
    });

    await restartedAgain.app.ready();
    await restartedAgain.services.scheduler.runTick();

    const quarantinedTransitions = await OrderModel.countDocuments({
      orderId: { $regex: '^ord_legacy_' },
      status: 'ERROR_MANUAL_REVIEW',
      manualReviewCode: 'SERVER_RESTART_REQUIRES_REVIEW',
    }).exec();
    const interruptedJobsAfterSecondBoot = await OutboxJobModel.countDocuments({
      status: 'INTERRUPTED',
      interruptionReason: 'SERVER_RESTART_REQUIRES_MANUAL_REVIEW',
    }).exec();

    expect(quarantinedTransitions).toBe(1201);
    expect(interruptedJobsAfterSecondBoot).toBe(2);
    const terminalOrderAfterSecondBoot = await OrderModel.findOne({ orderId: 'ord_legacy_terminal' })
      .lean()
      .exec();
    expect(terminalOrderAfterSecondBoot?.status).toBe('COMPLETED');
    expect(terminalOrderAfterSecondBoot?.manualReviewRequired).toBe(false);

    await restartedAgain.app.close();
    testApp.config.scheduler.enabled = previousEnabled;
    testApp.config.scheduler.pollMs = previousPollMs;
    await restorePrimaryApp();
  });

});
