import type {
  CryptoCurrencyApiForwardResult,
  CryptoCurrencyApiGiveResult,
  CryptoCurrencyApiNormalizedWebhook,
  CryptoCurrencyApiRequestStatusResult,
  CryptoCurrencyApiSendResult,
} from './cryptocurrencyapi.types';
import { CryptoCurrencyApiBadResponseError } from './cryptocurrencyapi.errors';

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const readString = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }

    if (typeof value === 'number') {
      return String(value);
    }
  }

  return null;
};

const readNumber = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return null;
};

export const parseProviderResponse = (payload: unknown): Record<string, unknown> => {
  const root = asRecord(payload);

  if (Object.keys(root).length === 0) {
    throw new CryptoCurrencyApiBadResponseError('CryptoCurrencyAPI devolvió una respuesta vacía.');
  }

  if (root['error']) {
    throw new CryptoCurrencyApiBadResponseError(
      'CryptoCurrencyAPI devolvió un error.',
      root['error'],
    );
  }

  return root;
};

export const mapGiveResponse = (payload: unknown): CryptoCurrencyApiGiveResult => {
  const root = parseProviderResponse(payload);
  const result = asRecord(root['result']);
  const source = Object.keys(result).length > 0 ? result : root;
  const address = readString(source, ['address', 'wallet', 'result']);

  if (!address) {
    throw new CryptoCurrencyApiBadResponseError(
      'CryptoCurrencyAPI no devolvió una dirección de depósito válida.',
      payload,
    );
  }

  return {
    address,
    publicKey: readString(source, ['publicKey', 'pubKey', 'public_key']),
    privateKey: readString(source, ['privateKey', 'private_key']),
    requestId: readString(source, ['requestId', 'request_id', 'id']),
    raw: root,
  };
};

export const mapForwardResponse = (payload: unknown): CryptoCurrencyApiForwardResult => {
  const root = parseProviderResponse(payload);
  const requestId =
    readString(root, ['result', 'requestId', 'request_id']) ??
    readString(asRecord(root['result']), ['id', 'requestId']);

  if (!requestId) {
    throw new CryptoCurrencyApiBadResponseError(
      'CryptoCurrencyAPI no devolvió un identificador de solicitud para el forward.',
      payload,
    );
  }

  return {
    providerRequestId: requestId,
    raw: root,
  };
};

export const mapSendResponse = (payload: unknown): CryptoCurrencyApiSendResult => {
  const root = parseProviderResponse(payload);
  const requestId =
    readString(root, ['result', 'requestId', 'request_id']) ??
    readString(asRecord(root['result']), ['id', 'requestId']);

  if (!requestId) {
    throw new CryptoCurrencyApiBadResponseError(
      'CryptoCurrencyAPI no devolvió un identificador de solicitud para el envío.',
      payload,
    );
  }

  return {
    providerRequestId: requestId,
    raw: root,
  };
};

export const mapRequestStatusResponse = (payload: unknown): CryptoCurrencyApiRequestStatusResult => {
  const root = parseProviderResponse(payload);
  const result = asRecord(root['result']);
  const source = Object.keys(result).length > 0 ? result : root;

  return {
    requestId: readString(source, ['id', 'requestId', 'request_id']),
    label: readString(source, ['label']),
    uniqID: readString(source, ['uniqID', 'uniqId', 'uniqid']),
    txid: readString(source, ['txid', 'txHash', 'hash']),
    token:
      readString(source, ['token', 'symbol', 'asset', 'currency'])?.toUpperCase() ?? null,
    fromAddress: readString(source, ['from', 'address']),
    toAddress: readString(source, ['to', 'wallet']),
    amount: readNumber(source, ['amount', 'value', 'sum']),
    state: readNumber(source, ['state', 'status']),
    result: readString(source, ['result', 'message', 'error']),
    raw: root,
  };
};

export const normalizeCryptoCurrencyApiWebhookPayload = (
  payload: Record<string, unknown>,
): CryptoCurrencyApiNormalizedWebhook => {
  const normalizedToken =
    readString(payload, ['token', 'symbol', 'asset', 'currency'])?.toUpperCase() ??
    readString(asRecord(payload['token']), ['symbol'])?.toUpperCase() ??
    null;

  const status = readString(payload, ['status', 'event', 'type']);
  const requestId = readString(payload, ['requestId', 'request_id', 'id', 'sendID', 'sendId']);
  const address = readString(payload, ['address', 'wallet', 'to', 'from']);
  const label = readString(payload, ['label', 'memo']);
  const uniqID = readString(payload, ['uniqID', 'uniqId', 'uniqid']);
  const txid = readString(payload, ['txid', 'txHash', 'hash']);
  const amount = readNumber(payload, ['amount', 'value', 'sum', 'received']);
  const confirmations = readNumber(payload, ['confirmations', 'confirmation', 'confirmed', 'confirms']);
  const network =
    readString(payload, ['network', 'blockchain', 'chain'])?.toUpperCase() ??
    (address?.startsWith('T') ? 'TRON' : null);
  const normalizedStatus = status?.toLowerCase() ?? '';
  const normalizedLabel = label?.toLowerCase() ?? '';
  const normalizedUniqId = uniqID?.toLowerCase() ?? '';

  const hasForwardPrefix =
    normalizedUniqId.startsWith('forward_') || normalizedLabel.startsWith('forward|');
  const hasSendPrefix =
    normalizedUniqId.startsWith('send_') || normalizedLabel.startsWith('send|');
  const isSendEvent = hasSendPrefix || normalizedStatus.includes('send');
  const isForwardEvent =
    hasForwardPrefix ||
    normalizedStatus.includes('forward') ||
    normalizedStatus.includes('sweep');

  const eventType =
    hasForwardPrefix
      ? 'forward'
      : hasSendPrefix
        ? 'send'
        : isSendEvent
      ? 'send'
      : isForwardEvent || (requestId !== null && address === null)
        ? 'forward'
      : txid || amount !== null
        ? 'deposit'
        : 'unknown';

  return {
    eventType,
    address,
    label,
    uniqID,
    txid,
    token: normalizedToken,
    network,
    amount,
    confirmations,
    status,
    requestId,
    rawPayload: payload,
  };
};
