import { z } from 'zod';

import { AppError } from '../errors/app-error';
import { parseBoolean, parseCsv } from '../../shared/utils/env';

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().min(1).default('info'),
  API_BASE_URL: z.string().url(),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1),
  CAS_API_KEY: z.string().min(1),
  INTERNAL_API_KEY: z.string().min(1),
  CRYPTOCURRENCY_API_BASE_URL: z.string().url(),
  CRYPTOCURRENCY_API_KEY: z.string().min(1),
  CRYPTOCURRENCY_API_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  CRYPTOCURRENCY_API_IP_ALLOWLIST: z.string().optional(),
  ITRX_API_BASE_URL: z.string().url(),
  ITRX_API_KEY: z.string().min(1),
  ITRX_API_SECRET: z.string().min(1),
  ITRX_API_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  ITRX_CALLBACK_MAX_AGE_SEC: z.coerce.number().int().positive().default(100),
  ITRX_IP_ALLOWLIST: z.string().optional(),
  TRON_FORWARD_TARGET_ADDRESS: z.string().min(1),
  TRON_BUY_SENDER_ADDRESS: z.string().min(1),
  TRON_USDT_TOKEN_SYMBOL: z.string().min(1).default('USDT'),
  ORDER_DEFAULT_WAIT_PERIOD_MIN: z.coerce.number().int().positive().default(20),
  ORDER_DEFAULT_PERIOD_MIN: z.coerce.number().int().positive().default(60),
  ORDER_EXPIRATION_GRACE_SEC: z.coerce.number().int().nonnegative().default(30),
  MIN_CONFIRMATIONS_USDT_TRC20: z.coerce.number().int().nonnegative().default(20),
  MIN_OPERATIONAL_USDT: z.coerce.number().positive().default(1),
  MIN_OPERATIONAL_USDT_BUY: z.coerce.number().positive().default(1),
  ALLOW_PARTIAL_DEPOSITS: z.string().optional(),
  AMOUNT_TOLERANCE_PERCENT: z.coerce.number().nonnegative().default(5),
  DEPOSIT_OBSERVED_MAX_WAIT_MINUTES: z.coerce.number().int().positive().max(1440).default(180),
  ENERGY_MODE: z.enum(['estimated', 'fixed']).default('estimated'),
  ENERGY_FIXED_AMOUNT: z.coerce.number().int().positive().default(80_000),
  ENERGY_SAFETY_MULTIPLIER: z.coerce.number().positive().default(1.2),
  ENERGY_MIN_FLOOR: z.coerce.number().int().positive().default(65_000),
  ENERGY_MAX_CAP: z.coerce.number().int().positive().default(120_000),
  ENERGY_MODE_BUY: z.enum(['estimated', 'fixed']).optional(),
  ENERGY_FIXED_AMOUNT_BUY: z.coerce.number().int().positive().optional(),
  ENERGY_SAFETY_MULTIPLIER_BUY: z.coerce.number().positive().optional(),
  ENERGY_ONE_OFF_PERIOD_BUY: z.string().min(1).default('1H'),
  ENERGY_PROVIDER_MIN_ORDER_BUY: z.coerce.number().int().nonnegative().default(0),
  ENERGY_MIN_FLOOR_BUY: z.coerce.number().int().nonnegative().optional(),
  ENERGY_MAX_CAP_BUY: z.coerce.number().int().positive().optional(),
  ENERGY_RENTAL_PERIOD: z.string().min(1).default('1H'),
  ENERGY_SMART_DELEGATE_DAYS: z.coerce.number().int().positive().default(5),
  ALLOW_FIXED_ENERGY_FALLBACK: z.string().optional(),
  ALLOW_FIXED_ENERGY_FALLBACK_BUY: z.string().optional(),
  ENERGY_MAX_RETRY_COUNT: z.coerce.number().int().positive().default(5),
  FORWARD_MAX_RETRY_COUNT: z.coerce.number().int().positive().default(5),
  FORWARD_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(5_000),
  BUY_MAX_RETRY_COUNT: z.coerce.number().int().positive().default(5),
  BUY_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(5_000),
  BUY_SEND_AMOUNT_TOLERANCE: z.coerce.number().nonnegative().default(0.000001),
  BUY_SEND_REQUIRE_EXACT_SENDER_MATCH: z.string().optional(),
  BUY_SEND_MIN_CONFIRMATIONS: z.coerce.number().int().positive().default(1),
  BUY_SEND_BROADCASTED_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  LOCK_TTL_SEC: z.coerce.number().int().positive().default(30),
  SCHEDULER_ENABLED: z.string().optional(),
  SCHEDULER_POLL_MS: z.coerce.number().int().positive().default(3_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  WEBHOOK_REQUIRE_IP_ALLOWLIST: z.string().optional(),
  WEBHOOK_RAW_BODY_LIMIT: z.string().min(1).default('1mb'),
  CORS_ORIGINS: z.string().optional(),
  STORE_ENCRYPTED_PRIVATE_KEYS: z.string().optional(),
  PRIVATE_KEY_ENCRYPTION_SECRET: z.string().optional(),
  PANEL_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  PANEL_STEP_UP_TTL_MIN: z.coerce.number().int().positive().default(10),
  PANEL_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PANEL_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  PANEL_ENCRYPTION_SECRET: z.string().min(1),
  PANEL_TOTP_ISSUER: z.string().min(1).default('GENERAL BYTES CAS Wallet'),
  PANEL_BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  PANEL_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
  PANEL_BOOTSTRAP_ADMIN_NAME: z.string().min(1).optional(),
  INTERRUPTED_OPERATION_POLICY: z.enum(['manual_review']).default('manual_review'),
  OUTBOX_COMPLETED_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  PROVIDER_EVENT_SUCCESS_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  AUDIT_RETENTION_ENABLED: z.string().optional(),
  STORAGE_CLEANUP_ENABLED: z.string().optional(),
  STORAGE_CLEANUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  STORAGE_CLEANUP_RECONCILE_DAYS: z.coerce.number().int().positive().default(7),
  STORAGE_CLEANUP_BATCH_SIZE: z.coerce.number().int().positive().default(1000),
  STORAGE_CLEANUP_MAX_BATCHES: z.coerce.number().int().positive().default(10),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  apiBaseUrl: string;
  mongodbUri: string;
  mongodbDbName: string;
  apiKeys: {
    cas: string;
    internal: string;
  };
  providers: {
    cryptocurrencyapi: {
      baseUrl: string;
      apiKey: string;
      timeoutMs: number;
      ipAllowlist: string[];
    };
    itrx: {
      baseUrl: string;
      apiKey: string;
      apiSecret: string;
      timeoutMs: number;
      callbackMaxAgeSec: number;
      ipAllowlist: string[];
    };
  };
  tron: {
    forwardTargetAddress: string;
    buySenderAddress: string;
    usdtTokenSymbol: string;
  };
  orders: {
    defaultWaitPeriodMin: number;
    defaultPeriodMin: number;
    expirationGraceSec: number;
    minConfirmationsUsdtTrc20: number;
    minOperationalUsdt: number;
    minOperationalUsdtBuy: number;
    allowPartialDeposits: boolean;
    amountTolerancePercent: number;
    depositObservedMaxWaitMinutes: number;
  };
  energy: {
    mode: 'estimated' | 'fixed';
    fixedAmount: number;
    safetyMultiplier: number;
    minFloor: number;
    maxCap: number;
    rentalPeriod: string;
    smartDelegateDays: number;
    allowFixedFallback: boolean;
    maxRetryCount: number;
  };
  energyBuy: {
    mode: 'estimated' | 'fixed';
    fixedAmount: number;
    safetyMultiplier: number;
    oneOffPeriod: string;
    providerMinOrder: number;
    minFloor: number;
    maxCap: number;
    allowFixedFallback: boolean;
  };
  forward: {
    maxRetryCount: number;
    retryBackoffMs: number;
  };
  buy: {
    maxRetryCount: number;
    retryBackoffMs: number;
    sendAmountTolerance: number;
    requireExactSenderMatch: boolean;
    minConfirmations: number;
    broadcastedTimeoutMinutes: number;
  };
  locks: {
    ttlSec: number;
  };
  scheduler: {
    enabled: boolean;
    pollMs: number;
  };
  security: {
    rateLimitMax: number;
    rateLimitWindowMs: number;
    webhookRequireIpAllowlist: boolean;
    webhookRawBodyLimit: string;
    corsOrigins: string[];
  };
  secrets: {
    storeEncryptedPrivateKeys: boolean;
    privateKeyEncryptionSecret: string | null;
  };
  panel: {
    sessionTtlHours: number;
    stepUpTtlMin: number;
    loginMaxAttempts: number;
    lockoutMinutes: number;
    encryptionSecret: string;
    totpIssuer: string;
    bootstrapAdmin: {
      email: string | null;
      password: string | null;
      name: string;
    };
  };
  operations: {
    interruptedOperationPolicy: 'manual_review';
  };
  retention: {
    outboxCompletedRetentionDays: number;
    providerEventSuccessRetentionDays: number;
    auditRetentionEnabled: boolean;
  };
  storageCleanup: {
    enabled: boolean;
    hour: number;
    reconcileDays: number;
    batchSize: number;
    maxBatches: number;
  };
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = rawEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      statusCode: 500,
      message: 'Las variables de entorno no son válidas.',
      details: parsed.error.flatten(),
    });
  }

  const raw = parsed.data;
  const storeEncryptedPrivateKeys = parseBoolean(raw.STORE_ENCRYPTED_PRIVATE_KEYS, false);
  const webhookRequireIpAllowlist = parseBoolean(raw.WEBHOOK_REQUIRE_IP_ALLOWLIST, false);
  const cryptoCurrencyApiIpAllowlist = parseCsv(raw.CRYPTOCURRENCY_API_IP_ALLOWLIST);

  if (storeEncryptedPrivateKeys && !raw.PRIVATE_KEY_ENCRYPTION_SECRET) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      statusCode: 500,
      message:
        'PRIVATE_KEY_ENCRYPTION_SECRET es obligatoria cuando STORE_ENCRYPTED_PRIVATE_KEYS=true.',
    });
  }

  if (
    (raw.PANEL_BOOTSTRAP_ADMIN_EMAIL && !raw.PANEL_BOOTSTRAP_ADMIN_PASSWORD) ||
    (!raw.PANEL_BOOTSTRAP_ADMIN_EMAIL && raw.PANEL_BOOTSTRAP_ADMIN_PASSWORD)
  ) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      statusCode: 500,
      message:
        'PANEL_BOOTSTRAP_ADMIN_EMAIL y PANEL_BOOTSTRAP_ADMIN_PASSWORD deben definirse juntos.',
    });
  }

  if (raw.NODE_ENV === 'production') {
    if (!webhookRequireIpAllowlist) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        statusCode: 500,
        message:
          'En produccion debes habilitar WEBHOOK_REQUIRE_IP_ALLOWLIST=true para aceptar webhooks externos de CryptoCurrencyAPI.',
      });
    }

    if (cryptoCurrencyApiIpAllowlist.length === 0) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        statusCode: 500,
        message:
          'En produccion debes definir CRYPTOCURRENCY_API_IP_ALLOWLIST con al menos una IP oficial del proveedor.',
      });
    }
  }

  return {
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    apiBaseUrl: raw.API_BASE_URL.replace(/\/$/, ''),
    mongodbUri: raw.MONGODB_URI,
    mongodbDbName: raw.MONGODB_DB_NAME,
    apiKeys: {
      cas: raw.CAS_API_KEY,
      internal: raw.INTERNAL_API_KEY,
    },
    providers: {
      cryptocurrencyapi: {
        baseUrl: raw.CRYPTOCURRENCY_API_BASE_URL.replace(/\/$/, ''),
        apiKey: raw.CRYPTOCURRENCY_API_KEY,
        timeoutMs: raw.CRYPTOCURRENCY_API_TIMEOUT_MS,
        ipAllowlist: cryptoCurrencyApiIpAllowlist,
      },
      itrx: {
        baseUrl: raw.ITRX_API_BASE_URL.replace(/\/$/, ''),
        apiKey: raw.ITRX_API_KEY,
        apiSecret: raw.ITRX_API_SECRET,
        timeoutMs: raw.ITRX_API_TIMEOUT_MS,
        callbackMaxAgeSec: raw.ITRX_CALLBACK_MAX_AGE_SEC,
        ipAllowlist: parseCsv(raw.ITRX_IP_ALLOWLIST),
      },
    },
    tron: {
      forwardTargetAddress: raw.TRON_FORWARD_TARGET_ADDRESS,
      buySenderAddress: raw.TRON_BUY_SENDER_ADDRESS,
      usdtTokenSymbol: raw.TRON_USDT_TOKEN_SYMBOL,
    },
    orders: {
      defaultWaitPeriodMin: raw.ORDER_DEFAULT_WAIT_PERIOD_MIN,
      defaultPeriodMin: raw.ORDER_DEFAULT_PERIOD_MIN,
      expirationGraceSec: raw.ORDER_EXPIRATION_GRACE_SEC,
      minConfirmationsUsdtTrc20: raw.MIN_CONFIRMATIONS_USDT_TRC20,
      minOperationalUsdt: raw.MIN_OPERATIONAL_USDT,
      minOperationalUsdtBuy: raw.MIN_OPERATIONAL_USDT_BUY,
      allowPartialDeposits: parseBoolean(raw.ALLOW_PARTIAL_DEPOSITS, false),
      amountTolerancePercent: raw.AMOUNT_TOLERANCE_PERCENT,
      depositObservedMaxWaitMinutes: raw.DEPOSIT_OBSERVED_MAX_WAIT_MINUTES,
    },
    energy: {
      mode: raw.ENERGY_MODE,
      fixedAmount: raw.ENERGY_FIXED_AMOUNT,
      safetyMultiplier: raw.ENERGY_SAFETY_MULTIPLIER,
      minFloor: raw.ENERGY_MIN_FLOOR,
      maxCap: raw.ENERGY_MAX_CAP,
      rentalPeriod: raw.ENERGY_RENTAL_PERIOD,
      smartDelegateDays: raw.ENERGY_SMART_DELEGATE_DAYS,
      allowFixedFallback: parseBoolean(raw.ALLOW_FIXED_ENERGY_FALLBACK, true),
      maxRetryCount: raw.ENERGY_MAX_RETRY_COUNT,
    },
    energyBuy: {
      mode: raw.ENERGY_MODE_BUY ?? raw.ENERGY_MODE,
      fixedAmount: raw.ENERGY_FIXED_AMOUNT_BUY ?? raw.ENERGY_FIXED_AMOUNT,
      safetyMultiplier: Math.max(raw.ENERGY_SAFETY_MULTIPLIER_BUY ?? 1, 1),
      oneOffPeriod: raw.ENERGY_ONE_OFF_PERIOD_BUY,
      providerMinOrder: raw.ENERGY_PROVIDER_MIN_ORDER_BUY,
      minFloor: raw.ENERGY_MIN_FLOOR_BUY ?? 0,
      maxCap: raw.ENERGY_MAX_CAP_BUY ?? 120_000,
      allowFixedFallback: parseBoolean(
        raw.ALLOW_FIXED_ENERGY_FALLBACK_BUY,
        false,
      ),
    },
    forward: {
      maxRetryCount: raw.FORWARD_MAX_RETRY_COUNT,
      retryBackoffMs: raw.FORWARD_RETRY_BACKOFF_MS,
    },
    buy: {
      maxRetryCount: raw.BUY_MAX_RETRY_COUNT,
      retryBackoffMs: raw.BUY_RETRY_BACKOFF_MS,
      sendAmountTolerance: raw.BUY_SEND_AMOUNT_TOLERANCE,
      requireExactSenderMatch: parseBoolean(raw.BUY_SEND_REQUIRE_EXACT_SENDER_MATCH, false),
      minConfirmations: raw.BUY_SEND_MIN_CONFIRMATIONS,
      broadcastedTimeoutMinutes: raw.BUY_SEND_BROADCASTED_TIMEOUT_MINUTES,
    },
    locks: {
      ttlSec: raw.LOCK_TTL_SEC,
    },
    scheduler: {
      enabled: parseBoolean(raw.SCHEDULER_ENABLED, true),
      pollMs: raw.SCHEDULER_POLL_MS,
    },
    security: {
      rateLimitMax: raw.RATE_LIMIT_MAX,
      rateLimitWindowMs: raw.RATE_LIMIT_WINDOW_MS,
      webhookRequireIpAllowlist,
      webhookRawBodyLimit: raw.WEBHOOK_RAW_BODY_LIMIT,
      corsOrigins: parseCsv(raw.CORS_ORIGINS),
    },
    secrets: {
      storeEncryptedPrivateKeys,
      privateKeyEncryptionSecret: raw.PRIVATE_KEY_ENCRYPTION_SECRET ?? null,
    },
    panel: {
      sessionTtlHours: raw.PANEL_SESSION_TTL_HOURS,
      stepUpTtlMin: raw.PANEL_STEP_UP_TTL_MIN,
      loginMaxAttempts: raw.PANEL_LOGIN_MAX_ATTEMPTS,
      lockoutMinutes: raw.PANEL_LOCKOUT_MINUTES,
      encryptionSecret: raw.PANEL_ENCRYPTION_SECRET,
      totpIssuer: raw.PANEL_TOTP_ISSUER,
      bootstrapAdmin: {
        email: raw.PANEL_BOOTSTRAP_ADMIN_EMAIL ?? null,
        password: raw.PANEL_BOOTSTRAP_ADMIN_PASSWORD ?? null,
        name: raw.PANEL_BOOTSTRAP_ADMIN_NAME ?? 'Administrador inicial',
      },
    },
    operations: {
      interruptedOperationPolicy: raw.INTERRUPTED_OPERATION_POLICY,
    },
    retention: {
      outboxCompletedRetentionDays: raw.OUTBOX_COMPLETED_RETENTION_DAYS,
      providerEventSuccessRetentionDays: raw.PROVIDER_EVENT_SUCCESS_RETENTION_DAYS,
      auditRetentionEnabled: parseBoolean(raw.AUDIT_RETENTION_ENABLED, false),
    },
    storageCleanup: {
      enabled: parseBoolean(raw.STORAGE_CLEANUP_ENABLED, false),
      hour: raw.STORAGE_CLEANUP_HOUR,
      reconcileDays: raw.STORAGE_CLEANUP_RECONCILE_DAYS,
      batchSize: raw.STORAGE_CLEANUP_BATCH_SIZE,
      maxBatches: raw.STORAGE_CLEANUP_MAX_BATCHES,
    },
  };
};
