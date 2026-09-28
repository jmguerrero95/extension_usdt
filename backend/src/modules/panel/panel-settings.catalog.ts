import type { AppConfig } from '../../app/config/env';
import { isValidTronAddress } from '../../shared/utils/tron-address';

export interface PanelSettingDefinition {
  key: string;
  label: string;
  category: string;
  description: string;
  isSecret: boolean;
  type: 'string' | 'number' | 'boolean' | 'enum';
  options?: string[];
  appliesOnRestart: boolean;
}

export const PANEL_SETTING_DEFINITIONS: PanelSettingDefinition[] = [
  {
    key: 'CRYPTOCURRENCY_API_BASE_URL',
    label: 'CryptoCurrencyAPI Base URL',
    category: 'proveedores',
    description: 'URL base del proveedor CryptoCurrencyAPI.',
    isSecret: false,
    type: 'string',
    appliesOnRestart: true,
  },
  {
    key: 'CRYPTOCURRENCY_API_KEY',
    label: 'CryptoCurrencyAPI API Key',
    category: 'proveedores',
    description: 'API key de autenticación hacia CryptoCurrencyAPI.',
    isSecret: true,
    type: 'string',
    appliesOnRestart: true,
  },
  {
    key: 'CRYPTOCURRENCY_API_TIMEOUT_MS',
    label: 'CryptoCurrencyAPI timeout',
    category: 'proveedores',
    description: 'Timeout hacia CryptoCurrencyAPI en milisegundos.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'ITRX_API_BASE_URL',
    label: 'iTRX Base URL',
    category: 'proveedores',
    description: 'URL base del proveedor iTRX.',
    isSecret: false,
    type: 'string',
    appliesOnRestart: true,
  },
  {
    key: 'ITRX_API_KEY',
    label: 'iTRX API Key',
    category: 'proveedores',
    description: 'API key para autenticar solicitudes hacia iTRX.',
    isSecret: true,
    type: 'string',
    appliesOnRestart: true,
  },
  {
    key: 'ITRX_API_SECRET',
    label: 'iTRX API Secret',
    category: 'proveedores',
    description: 'Secreto HMAC para firmas con iTRX.',
    isSecret: true,
    type: 'string',
    appliesOnRestart: true,
  },
  {
    key: 'ITRX_API_TIMEOUT_MS',
    label: 'iTRX timeout',
    category: 'proveedores',
    description: 'Timeout hacia iTRX en milisegundos.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'TRON_FORWARD_TARGET_ADDRESS',
    label: 'Wallet central SELL',
    category: 'wallets',
    description: 'Dirección central de sweep para órdenes SELL.',
    isSecret: false,
    type: 'string',
    appliesOnRestart: true,
  },
  {
    key: 'TRON_BUY_SENDER_ADDRESS',
    label: 'Wallet emisora BUY',
    category: 'wallets',
    description: 'Dirección hot wallet usada para envíos BUY.',
    isSecret: false,
    type: 'string',
    appliesOnRestart: true,
  },
  {
    key: 'ORDER_DEFAULT_WAIT_PERIOD_MIN',
    label: 'Wait period SELL',
    category: 'órdenes',
    description: 'Minutos de espera de depósito SELL.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'ORDER_DEFAULT_PERIOD_MIN',
    label: 'Periodo general de orden',
    category: 'órdenes',
    description: 'Periodo base usado por el flujo operativo.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'MIN_OPERATIONAL_USDT',
    label: 'Mínimo operacional SELL',
    category: 'órdenes',
    description: 'Mínimo operacional USDT para SELL.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'MIN_OPERATIONAL_USDT_BUY',
    label: 'Mínimo operacional BUY',
    category: 'órdenes',
    description: 'Mínimo operacional USDT para BUY.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'ENERGY_MODE',
    label: 'Modo energía SELL',
    category: 'energía',
    description: 'Modo de energía para SELL.',
    isSecret: false,
    type: 'enum',
    options: ['estimated', 'fixed'],
    appliesOnRestart: true,
  },
  {
    key: 'ENERGY_FIXED_AMOUNT',
    label: 'Energía fija SELL',
    category: 'energía',
    description: 'Monto fijo de energía para SELL.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'ENERGY_MODE_BUY',
    label: 'Modo energía BUY',
    category: 'energía',
    description: 'Modo de energía para BUY.',
    isSecret: false,
    type: 'enum',
    options: ['estimated', 'fixed'],
    appliesOnRestart: true,
  },
  {
    key: 'ENERGY_FIXED_AMOUNT_BUY',
    label: 'Energía fija BUY',
    category: 'energía',
    description: 'Monto fijo de energía para BUY.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'ENERGY_MAX_RETRY_COUNT',
    label: 'Reintentos energía',
    category: 'reintentos',
    description: 'Máximo de reintentos automáticos al pedir energía.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'FORWARD_MAX_RETRY_COUNT',
    label: 'Reintentos forward',
    category: 'reintentos',
    description: 'Máximo de reintentos para forward SELL.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'BUY_MAX_RETRY_COUNT',
    label: 'Reintentos BUY',
    category: 'reintentos',
    description: 'Máximo de reintentos para envío BUY.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'BUY_SEND_AMOUNT_TOLERANCE',
    label: 'Tolerancia monto BUY',
    category: 'ordenes',
    description: 'Tolerancia absoluta permitida al validar el monto on-chain del send BUY.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'BUY_SEND_REQUIRE_EXACT_SENDER_MATCH',
    label: 'Sender estricto BUY',
    category: 'ordenes',
    description: 'Exige coincidencia exacta del sender on-chain para cerrar un BUY.',
    isSecret: false,
    type: 'boolean',
    appliesOnRestart: true,
  },
  {
    key: 'BUY_SEND_MIN_CONFIRMATIONS',
    label: 'Confirmaciones BUY',
    category: 'ordenes',
    description: 'Confirmaciones minimas on-chain para cerrar el send BUY.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
  {
    key: 'BUY_SEND_BROADCASTED_TIMEOUT_MINUTES',
    label: 'Timeout BUY broadcasted',
    category: 'ordenes',
    description: 'Minutos maximos permitidos en SEND_BROADCASTED antes de manual review.',
    isSecret: false,
    type: 'number',
    appliesOnRestart: true,
  },
];

const settingValueGetters: Record<string, (config: AppConfig) => string | number | boolean> = {
  CRYPTOCURRENCY_API_BASE_URL: (config) => config.providers.cryptocurrencyapi.baseUrl,
  CRYPTOCURRENCY_API_KEY: (config) => config.providers.cryptocurrencyapi.apiKey,
  CRYPTOCURRENCY_API_TIMEOUT_MS: (config) => config.providers.cryptocurrencyapi.timeoutMs,
  ITRX_API_BASE_URL: (config) => config.providers.itrx.baseUrl,
  ITRX_API_KEY: (config) => config.providers.itrx.apiKey,
  ITRX_API_SECRET: (config) => config.providers.itrx.apiSecret,
  ITRX_API_TIMEOUT_MS: (config) => config.providers.itrx.timeoutMs,
  TRON_FORWARD_TARGET_ADDRESS: (config) => config.tron.forwardTargetAddress,
  TRON_BUY_SENDER_ADDRESS: (config) => config.tron.buySenderAddress,
  ORDER_DEFAULT_WAIT_PERIOD_MIN: (config) => config.orders.defaultWaitPeriodMin,
  ORDER_DEFAULT_PERIOD_MIN: (config) => config.orders.defaultPeriodMin,
  MIN_OPERATIONAL_USDT: (config) => config.orders.minOperationalUsdt,
  MIN_OPERATIONAL_USDT_BUY: (config) => config.orders.minOperationalUsdtBuy,
  ENERGY_MODE: (config) => config.energy.mode,
  ENERGY_FIXED_AMOUNT: (config) => config.energy.fixedAmount,
  ENERGY_MODE_BUY: (config) => config.energyBuy.mode,
  ENERGY_FIXED_AMOUNT_BUY: (config) => config.energyBuy.fixedAmount,
  ENERGY_MAX_RETRY_COUNT: (config) => config.energy.maxRetryCount,
  FORWARD_MAX_RETRY_COUNT: (config) => config.forward.maxRetryCount,
  BUY_MAX_RETRY_COUNT: (config) => config.buy.maxRetryCount,
  BUY_SEND_AMOUNT_TOLERANCE: (config) => config.buy.sendAmountTolerance,
  BUY_SEND_REQUIRE_EXACT_SENDER_MATCH: (config) => config.buy.requireExactSenderMatch,
  BUY_SEND_MIN_CONFIRMATIONS: (config) => config.buy.minConfirmations,
  BUY_SEND_BROADCASTED_TIMEOUT_MINUTES: (config) => config.buy.broadcastedTimeoutMinutes,
};

export const getPanelSettingDefinition = (key: string): PanelSettingDefinition | undefined =>
  PANEL_SETTING_DEFINITIONS.find((definition) => definition.key === key);

export const getConfigValueForPanelSetting = (
  config: AppConfig,
  key: string,
): string | number | boolean | null => settingValueGetters[key]?.(config) ?? null;

export const coercePanelSettingValue = (
  definition: PanelSettingDefinition,
  rawValue: string,
): string | number | boolean => {
  const trimmed = rawValue.trim();

  switch (definition.type) {
    case 'number': {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        throw new Error(`El valor para ${definition.key} debe ser numérico.`);
      }

      return parsed;
    }
    case 'boolean':
      if (!['true', 'false'].includes(trimmed)) {
        throw new Error(`El valor para ${definition.key} debe ser true o false.`);
      }

      return trimmed === 'true';
    case 'enum':
      if (!definition.options?.includes(trimmed)) {
        throw new Error(`El valor para ${definition.key} no es válido.`);
      }

      if (definition.key.endsWith('_BASE_URL')) {
        try {
          const url = new URL(trimmed);
          return url.toString().replace(/\/$/, '');
        } catch {
          throw new Error(`El valor para ${definition.key} debe ser una URL valida.`);
        }
      }

      if (
        ['TRON_FORWARD_TARGET_ADDRESS', 'TRON_BUY_SENDER_ADDRESS'].includes(definition.key) &&
        !isValidTronAddress(trimmed)
      ) {
        throw new Error(`El valor para ${definition.key} debe ser una direccion TRON valida.`);
      }

      return trimmed;
    default:
      if (trimmed === '') {
        throw new Error(`El valor para ${definition.key} no puede quedar vacío.`);
      }

      return trimmed;
  }
};

export const applyPanelSettingToConfig = (
  config: AppConfig,
  key: string,
  value: string | number | boolean,
): void => {
  switch (key) {
    case 'CRYPTOCURRENCY_API_BASE_URL':
      config.providers.cryptocurrencyapi.baseUrl = String(value);
      break;
    case 'CRYPTOCURRENCY_API_KEY':
      config.providers.cryptocurrencyapi.apiKey = String(value);
      break;
    case 'CRYPTOCURRENCY_API_TIMEOUT_MS':
      config.providers.cryptocurrencyapi.timeoutMs = Number(value);
      break;
    case 'ITRX_API_BASE_URL':
      config.providers.itrx.baseUrl = String(value);
      break;
    case 'ITRX_API_KEY':
      config.providers.itrx.apiKey = String(value);
      break;
    case 'ITRX_API_SECRET':
      config.providers.itrx.apiSecret = String(value);
      break;
    case 'ITRX_API_TIMEOUT_MS':
      config.providers.itrx.timeoutMs = Number(value);
      break;
    case 'TRON_FORWARD_TARGET_ADDRESS':
      config.tron.forwardTargetAddress = String(value);
      break;
    case 'TRON_BUY_SENDER_ADDRESS':
      config.tron.buySenderAddress = String(value);
      break;
    case 'ORDER_DEFAULT_WAIT_PERIOD_MIN':
      config.orders.defaultWaitPeriodMin = Number(value);
      break;
    case 'ORDER_DEFAULT_PERIOD_MIN':
      config.orders.defaultPeriodMin = Number(value);
      break;
    case 'MIN_OPERATIONAL_USDT':
      config.orders.minOperationalUsdt = Number(value);
      break;
    case 'MIN_OPERATIONAL_USDT_BUY':
      config.orders.minOperationalUsdtBuy = Number(value);
      break;
    case 'ENERGY_MODE':
      config.energy.mode = String(value) as AppConfig['energy']['mode'];
      break;
    case 'ENERGY_FIXED_AMOUNT':
      config.energy.fixedAmount = Number(value);
      break;
    case 'ENERGY_MODE_BUY':
      config.energyBuy.mode = String(value) as AppConfig['energyBuy']['mode'];
      break;
    case 'ENERGY_FIXED_AMOUNT_BUY':
      config.energyBuy.fixedAmount = Number(value);
      break;
    case 'ENERGY_MAX_RETRY_COUNT':
      config.energy.maxRetryCount = Number(value);
      break;
    case 'FORWARD_MAX_RETRY_COUNT':
      config.forward.maxRetryCount = Number(value);
      break;
    case 'BUY_MAX_RETRY_COUNT':
      config.buy.maxRetryCount = Number(value);
      break;
    case 'BUY_SEND_AMOUNT_TOLERANCE':
      config.buy.sendAmountTolerance = Number(value);
      break;
    case 'BUY_SEND_REQUIRE_EXACT_SENDER_MATCH':
      config.buy.requireExactSenderMatch = Boolean(value);
      break;
    case 'BUY_SEND_MIN_CONFIRMATIONS':
      config.buy.minConfirmations = Number(value);
      break;
    case 'BUY_SEND_BROADCASTED_TIMEOUT_MINUTES':
      config.buy.broadcastedTimeoutMinutes = Number(value);
      break;
    default:
      break;
  }
};
