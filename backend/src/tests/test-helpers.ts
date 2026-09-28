import pino from 'pino';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { bootstrapApplication } from '../app/bootstrap';
import type { AppConfig } from '../app/config/env';
import { EnergyRequestModel } from '../infrastructure/db/models/energy-request.model';
import { ForwardRequestModel } from '../infrastructure/db/models/forward-request.model';
import { OrderStateTransitionModel } from '../infrastructure/db/models/order-state-transition.model';
import { OrderModel } from '../infrastructure/db/models/order.model';
import { OutboxJobModel } from '../infrastructure/db/models/outbox-job.model';
import { ProviderEventModel } from '../infrastructure/db/models/provider-event.model';
import { DistributedLockModel } from '../infrastructure/db/models/distributed-lock.model';
import { SendRequestModel } from '../infrastructure/db/models/send-request.model';
import { InternalUserModel } from '../infrastructure/db/models/internal-user.model';
import { AdminSessionModel } from '../infrastructure/db/models/admin-session.model';
import { AdminAuditLogModel } from '../infrastructure/db/models/admin-audit-log.model';
import { OrderNoteModel } from '../infrastructure/db/models/order-note.model';
import { SystemSettingModel } from '../infrastructure/db/models/system-setting.model';

export const buildTestConfig = (mongodbUri: string, overrides: Partial<AppConfig> = {}): AppConfig => ({
  nodeEnv: 'test',
  port: 0,
  logLevel: 'silent',
  apiBaseUrl: 'http://127.0.0.1:3000',
  mongodbUri,
  mongodbDbName: 'gb_cas_sell_api_test',
  apiKeys: {
    cas: 'cas-test-key',
    internal: 'internal-test-key',
  },
  providers: {
    cryptocurrencyapi: {
      baseUrl: 'https://cryptocurrencyapi.test',
      apiKey: 'crypto-test-key',
      timeoutMs: 2000,
      ipAllowlist: [],
    },
    itrx: {
      baseUrl: 'https://itrx.test',
      apiKey: 'itrx-test-key',
      apiSecret: 'itrx-secret',
      timeoutMs: 2000,
      callbackMaxAgeSec: 300,
      ipAllowlist: [],
    },
  },
  tron: {
    forwardTargetAddress: 'TCENTRALWALLET1234567890',
    buySenderAddress: 'TBUYSENDER123456789012345678901234',
    usdtTokenSymbol: 'USDT',
  },
  orders: {
    defaultWaitPeriodMin: 20,
    defaultPeriodMin: 60,
    expirationGraceSec: 1,
    minConfirmationsUsdtTrc20: 20,
    minOperationalUsdt: 1,
    minOperationalUsdtBuy: 1,
    allowPartialDeposits: false,
    amountTolerancePercent: 5,
    depositObservedMaxWaitMinutes: 180,
  },
  energy: {
    mode: 'estimated',
    fixedAmount: 80000,
    safetyMultiplier: 1.2,
    minFloor: 65000,
    maxCap: 120000,
    rentalPeriod: '1H',
    smartDelegateDays: 5,
    allowFixedFallback: true,
    maxRetryCount: 5,
  },
  energyBuy: {
    mode: 'estimated',
    fixedAmount: 80000,
    safetyMultiplier: 1,
    oneOffPeriod: '1H',
    providerMinOrder: 0,
    minFloor: 0,
    maxCap: 120000,
    allowFixedFallback: false,
  },
  forward: {
    maxRetryCount: 5,
    retryBackoffMs: 100,
  },
  buy: {
    maxRetryCount: 5,
    retryBackoffMs: 100,
    sendAmountTolerance: 0.000001,
    requireExactSenderMatch: false,
    minConfirmations: 1,
    broadcastedTimeoutMinutes: 30,
  },
  locks: {
    ttlSec: 30,
  },
  scheduler: {
    enabled: false,
    pollMs: 50,
  },
  security: {
    rateLimitMax: 1000,
    rateLimitWindowMs: 60_000,
    webhookRequireIpAllowlist: false,
    webhookRawBodyLimit: '1mb',
    corsOrigins: [],
  },
  secrets: {
    storeEncryptedPrivateKeys: false,
    privateKeyEncryptionSecret: null,
  },
  panel: {
    sessionTtlHours: 12,
    stepUpTtlMin: 10,
    loginMaxAttempts: 5,
    lockoutMinutes: 15,
    encryptionSecret: 'panel-encryption-secret',
    totpIssuer: 'GB CAS Wallet Test',
    bootstrapAdmin: {
      email: 'admin@example.com',
      password: 'AdminPanelPassword123!',
      name: 'Administrador Test',
    },
  },
  operations: {
    interruptedOperationPolicy: 'manual_review',
  },
  retention: {
    outboxCompletedRetentionDays: 7,
    providerEventSuccessRetentionDays: 90,
    auditRetentionEnabled: false,
  },
  storageCleanup: {
    enabled: false,
    hour: 3,
    reconcileDays: 7,
    batchSize: 1000,
    maxBatches: 10,
  },
  ...overrides,
});

export const createTestApp = async (overrides: Partial<AppConfig> = {}) => {
  const mongo = await MongoMemoryServer.create();
  const config = buildTestConfig(mongo.getUri(), overrides);
  const logger = pino({ level: 'silent' });
  const boot = await bootstrapApplication({
    config,
    logger,
    startScheduler: false,
  });

  await boot.app.ready();

  return {
    mongo,
    ...boot,
  };
};

export const clearDatabase = async (): Promise<void> => {
  await Promise.all([
    OrderModel.deleteMany({}),
    ProviderEventModel.deleteMany({}),
    EnergyRequestModel.deleteMany({}),
    ForwardRequestModel.deleteMany({}),
    SendRequestModel.deleteMany({}),
    OrderStateTransitionModel.deleteMany({}),
    DistributedLockModel.deleteMany({}),
    OutboxJobModel.deleteMany({}),
    InternalUserModel.deleteMany({}),
    AdminSessionModel.deleteMany({}),
    AdminAuditLogModel.deleteMany({}),
    OrderNoteModel.deleteMany({}),
    SystemSettingModel.deleteMany({}),
  ]);
};

export const closeTestApp = async (
  input: { app: { close(): Promise<void> }; mongo: MongoMemoryServer } | undefined,
) => {
  if (!input) {
    return;
  }

  try {
    await input.app.close();
  } catch {
    // Ignorado: algunos tests cierran la app antes del cleanup global.
  }
  await mongoose.disconnect().catch(() => undefined);
  await input.mongo.stop();
};
