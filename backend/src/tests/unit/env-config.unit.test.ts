import { describe, expect, it } from 'vitest';

import { AppError } from '../../app/errors/app-error';
import { loadConfig } from '../../app/config/env';

const buildEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  PORT: '3000',
  LOG_LEVEL: 'info',
  API_BASE_URL: 'https://api.example.com',
  MONGODB_URI: 'mongodb://localhost:27017',
  MONGODB_DB_NAME: 'gb_cas_wallet_api',
  CAS_API_KEY: 'cas-test-key',
  INTERNAL_API_KEY: 'internal-test-key',
  CRYPTOCURRENCY_API_BASE_URL: 'https://cryptocurrencyapi.test',
  CRYPTOCURRENCY_API_KEY: 'crypto-test-key',
  CRYPTOCURRENCY_API_TIMEOUT_MS: '2000',
  CRYPTOCURRENCY_API_IP_ALLOWLIST: '',
  ITRX_API_BASE_URL: 'https://itrx.test',
  ITRX_API_KEY: 'itrx-key',
  ITRX_API_SECRET: 'itrx-secret',
  ITRX_API_TIMEOUT_MS: '2000',
  ITRX_CALLBACK_MAX_AGE_SEC: '300',
  ITRX_IP_ALLOWLIST: '',
  TRON_FORWARD_TARGET_ADDRESS: 'TCENTRALWALLET1234567890',
  TRON_BUY_SENDER_ADDRESS: 'TBUYSENDER123456789012345678901234',
  TRON_USDT_TOKEN_SYMBOL: 'USDT',
  ORDER_DEFAULT_WAIT_PERIOD_MIN: '20',
  ORDER_DEFAULT_PERIOD_MIN: '60',
  ORDER_EXPIRATION_GRACE_SEC: '30',
  MIN_CONFIRMATIONS_USDT_TRC20: '20',
  MIN_OPERATIONAL_USDT: '1',
  MIN_OPERATIONAL_USDT_BUY: '1',
  ALLOW_PARTIAL_DEPOSITS: 'false',
  AMOUNT_TOLERANCE_PERCENT: '5',
  DEPOSIT_OBSERVED_MAX_WAIT_MINUTES: '180',
  ENERGY_MODE: 'estimated',
  ENERGY_FIXED_AMOUNT: '80000',
  ENERGY_SAFETY_MULTIPLIER: '1.2',
  ENERGY_MIN_FLOOR: '65000',
  ENERGY_MAX_CAP: '120000',
  ENERGY_MODE_BUY: 'estimated',
  ENERGY_FIXED_AMOUNT_BUY: '80000',
  ENERGY_SAFETY_MULTIPLIER_BUY: '1.2',
  ENERGY_MIN_FLOOR_BUY: '65000',
  ENERGY_MAX_CAP_BUY: '120000',
  ENERGY_RENTAL_PERIOD: '1H',
  ENERGY_SMART_DELEGATE_DAYS: '5',
  ALLOW_FIXED_ENERGY_FALLBACK: 'true',
  ALLOW_FIXED_ENERGY_FALLBACK_BUY: 'true',
  ENERGY_MAX_RETRY_COUNT: '5',
  FORWARD_MAX_RETRY_COUNT: '5',
  FORWARD_RETRY_BACKOFF_MS: '5000',
  BUY_MAX_RETRY_COUNT: '5',
  BUY_RETRY_BACKOFF_MS: '5000',
  BUY_SEND_AMOUNT_TOLERANCE: '0.000001',
  BUY_SEND_REQUIRE_EXACT_SENDER_MATCH: 'false',
  BUY_SEND_MIN_CONFIRMATIONS: '1',
  BUY_SEND_BROADCASTED_TIMEOUT_MINUTES: '30',
  LOCK_TTL_SEC: '30',
  SCHEDULER_ENABLED: 'false',
  SCHEDULER_POLL_MS: '3000',
  RATE_LIMIT_MAX: '100',
  RATE_LIMIT_WINDOW_MS: '60000',
  WEBHOOK_REQUIRE_IP_ALLOWLIST: 'false',
  WEBHOOK_RAW_BODY_LIMIT: '1mb',
  CORS_ORIGINS: '',
  STORE_ENCRYPTED_PRIVATE_KEYS: 'false',
  PANEL_SESSION_TTL_HOURS: '12',
  PANEL_STEP_UP_TTL_MIN: '10',
  PANEL_LOGIN_MAX_ATTEMPTS: '5',
  PANEL_LOCKOUT_MINUTES: '15',
  PANEL_ENCRYPTION_SECRET: 'panel-encryption-secret',
  PANEL_TOTP_ISSUER: 'GB CAS Wallet Test',
  PANEL_BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  PANEL_BOOTSTRAP_ADMIN_PASSWORD: 'AdminPanelPassword123!',
  PANEL_BOOTSTRAP_ADMIN_NAME: 'Administrador Test',
  INTERRUPTED_OPERATION_POLICY: 'manual_review',
  OUTBOX_COMPLETED_RETENTION_DAYS: '7',
  PROVIDER_EVENT_SUCCESS_RETENTION_DAYS: '90',
  AUDIT_RETENTION_ENABLED: 'false',
  STORAGE_CLEANUP_ENABLED: 'false',
  STORAGE_CLEANUP_HOUR: '3',
  STORAGE_CLEANUP_RECONCILE_DAYS: '7',
  STORAGE_CLEANUP_BATCH_SIZE: '1000',
  STORAGE_CLEANUP_MAX_BATCHES: '10',
});

describe('loadConfig', () => {
  it('falla en produccion si la allowlist de webhooks externos esta deshabilitada', () => {
    expect(() =>
      loadConfig({
        ...buildEnv(),
        NODE_ENV: 'production',
        WEBHOOK_REQUIRE_IP_ALLOWLIST: 'false',
      }),
    ).toThrowError(AppError);
  });

  it('falla en produccion si la allowlist de CryptoCurrencyAPI esta vacia', () => {
    expect(() =>
      loadConfig({
        ...buildEnv(),
        NODE_ENV: 'production',
        WEBHOOK_REQUIRE_IP_ALLOWLIST: 'true',
        CRYPTOCURRENCY_API_IP_ALLOWLIST: '',
      }),
    ).toThrowError(AppError);
  });

  it('permite produccion cuando el webhook externo tiene allowlist valida', () => {
    const config = loadConfig({
      ...buildEnv(),
      NODE_ENV: 'production',
      WEBHOOK_REQUIRE_IP_ALLOWLIST: 'true',
      CRYPTOCURRENCY_API_IP_ALLOWLIST: '203.0.113.10,203.0.113.11',
    });

    expect(config.security.webhookRequireIpAllowlist).toBe(true);
    expect(config.providers.cryptocurrencyapi.ipAllowlist).toEqual([
      '203.0.113.10',
      '203.0.113.11',
    ]);
  });

  it('mantiene desarrollo y test sin exigir allowlist externa', () => {
    expect(loadConfig(buildEnv()).nodeEnv).toBe('development');
    expect(
      loadConfig({
        ...buildEnv(),
        NODE_ENV: 'test',
      }).nodeEnv,
    ).toBe('test');
  });

  it('valida DEPOSIT_OBSERVED_MAX_WAIT_MINUTES con default y rango seguro', () => {
    expect(loadConfig(buildEnv()).orders.depositObservedMaxWaitMinutes).toBe(180);
    expect(() =>
      loadConfig({
        ...buildEnv(),
        DEPOSIT_OBSERVED_MAX_WAIT_MINUTES: '0',
      }),
    ).toThrowError(AppError);
    expect(() =>
      loadConfig({
        ...buildEnv(),
        DEPOSIT_OBSERVED_MAX_WAIT_MINUTES: '-5',
      }),
    ).toThrowError(AppError);
    expect(() =>
      loadConfig({
        ...buildEnv(),
        DEPOSIT_OBSERVED_MAX_WAIT_MINUTES: '2000',
      }),
    ).toThrowError(AppError);
  });
});
