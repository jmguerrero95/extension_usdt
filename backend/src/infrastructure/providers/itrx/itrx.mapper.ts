import type {
  ItrxAutoDelegateResult,
  ItrxCallbackPayload,
  ItrxCollectionManualResult,
  ItrxEstimatedPriceResult,
  ItrxOneOffOrderResult,
  ItrxOrderQueryResult,
  ItrxSmartDelegatePolicyItem,
  ItrxSmartDelegatePolicyQueryResult,
} from './itrx.types';
import { ItrxBadResponseError } from './itrx.errors';

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

export const mapEstimatedPriceResponse = (payload: unknown): ItrxEstimatedPriceResult => {
  const root = asRecord(payload);
  const period = readString(root, ['period']);
  const energyAmount = readNumber(root, ['energy_amount', 'energyAmount']);
  const totalPriceSun = readNumber(root, ['total_price', 'totalPrice']);

  if (!period || energyAmount === null || totalPriceSun === null) {
    throw new ItrxBadResponseError(
      'iTRX devolvió una estimación inválida.',
      payload,
    );
  }

  return {
    period,
    energyAmount,
    totalPriceSun,
    raw: root,
  };
};

export const mapAutoDelegateResponse = (payload: unknown): ItrxAutoDelegateResult => {
  const root = asRecord(payload);
  const errno = readNumber(root, ['errno']);
  const message = readString(root, ['message']) ?? 'Respuesta sin mensaje';

  if (errno === null) {
    throw new ItrxBadResponseError(
      'iTRX devolvió una respuesta inválida al crear la política de energía.',
      payload,
    );
  }

  return {
    errno,
    message,
    balance: readNumber(root, ['balance']),
    raw: root,
  };
};

export const mapCollectionManualResponse = (payload: unknown): ItrxCollectionManualResult => {
  const root = asRecord(payload);
  const errno = readNumber(root, ['errno']);
  const message = readString(root, ['message']) ?? 'Respuesta sin mensaje';

  if (errno === null) {
    throw new ItrxBadResponseError(
      'iTRX devolvió una respuesta inválida al crear la orden de collection.',
      payload,
    );
  }

  return {
    errno,
    message,
    serial: readString(root, ['serial', 'order_no']),
    scene: readNumber(root, ['scene']),
    amount: readNumber(root, ['amount']),
    balance: readNumber(root, ['balance']),
    raw: root,
  };
};

export const mapOneOffOrderResponse = (payload: unknown): ItrxOneOffOrderResult => {
  const root = asRecord(payload);
  const errno = readNumber(root, ['errno']);
  const message = readString(root, ['message']) ?? 'Respuesta sin mensaje';
  const serial = readString(root, ['serial', 'order_no']);
  const amount = readNumber(root, ['amount']);
  const balance = readNumber(root, ['balance']);

  if (errno === null || !serial || amount === null || balance === null) {
    throw new ItrxBadResponseError(
      'iTRX devolvio una respuesta invalida al crear la orden one-off.',
      payload,
    );
  }

  return {
    errno,
    message,
    serial,
    amount,
    balance,
    raw: root,
  };
};

const mapSmartDelegatePolicyItem = (payload: unknown): ItrxSmartDelegatePolicyItem | null => {
  const root = asRecord(payload);
  const receiveAddress = readString(root, ['receive_address', 'receiveAddress']);
  const status = readNumber(root, ['status']);

  if (!receiveAddress || status === null) {
    return null;
  }

  return {
    id: readNumber(root, ['id']),
    receiveAddress,
    status,
    lastStep: readNumber(root, ['last_step', 'lastStep']),
    mainDelegated:
      typeof root['main_delegated'] === 'boolean' ? root['main_delegated'] : null,
    statusDisplay: readString(root, ['status_display', 'statusDisplay']),
    lastStepDisplay: readString(root, ['last_step_display', 'lastStepDisplay']),
    autoType: readNumber(root, ['auto_type', 'autoType']),
    autoTypeDisplay: readString(root, ['auto_type_display', 'autoTypeDisplay']),
    nextDelegateTime: readString(root, ['next_delegate_time', 'nextDelegateTime']),
    maxEnergy: readNumber(root, ['max_energy', 'maxEnergy']),
    period: readNumber(root, ['period']),
    raw: root,
  };
};

export const mapSmartDelegatePolicyQueryResponse = (
  payload: unknown,
): ItrxSmartDelegatePolicyQueryResult => {
  const root = asRecord(payload);
  const code = readNumber(root, ['code']);

  if (code === null) {
    throw new ItrxBadResponseError(
      'iTRX devolvio una respuesta invalida al consultar Smart Delegate.',
      {
        kind: 'MALFORMED_RESPONSE',
        raw: payload,
      },
    );
  }

  if (code !== 0) {
    throw new ItrxBadResponseError(
      'iTRX devolvio un code distinto de 0 al consultar Smart Delegate.',
      {
        kind: 'NON_SUCCESS_CODE',
        code,
        raw: root,
      },
    );
  }

  const rawResults = Array.isArray(root['results']) ? root['results'] : null;
  if (!rawResults) {
    throw new ItrxBadResponseError(
      'iTRX devolvio una respuesta de Smart Delegate sin results validos.',
      {
        kind: 'MALFORMED_RESPONSE',
        code,
        raw: root,
      },
    );
  }

  return {
    code,
    count: readNumber(root, ['count']),
    results: rawResults
      .map((item) => mapSmartDelegatePolicyItem(item))
      .filter((item): item is ItrxSmartDelegatePolicyItem => item !== null),
    raw: root,
  };
};

export const mapOrderQueryResponse = (payload: unknown): ItrxOrderQueryResult => {
  const root = asRecord(payload);
  const errno = readNumber(root, ['errno']);
  const message = readString(root, ['message', 'msg']);
  const status = readNumber(root, ['status']);

  if (errno === null) {
    throw new ItrxBadResponseError(
      'iTRX devolvio una respuesta invalida al consultar la orden.',
      {
        kind: 'MALFORMED_RESPONSE',
        raw: payload,
      },
    );
  }

  if (errno !== 0) {
    throw new ItrxBadResponseError(
      'iTRX devolvio un errno distinto de 0 al consultar la orden.',
      {
        kind: 'NON_SUCCESS_ERRNO',
        errno,
        message,
        raw: root,
      },
    );
  }

  if (status === null) {
    throw new ItrxBadResponseError(
      'iTRX devolvio una respuesta de orden sin status valido.',
      {
        kind: 'MALFORMED_RESPONSE',
        errno,
        raw: root,
      },
    );
  }

  return {
    errno,
    status,
    serial: readString(root, ['serial', 'order_no']),
    receiveAddress: readString(root, ['receive_address', 'receiveAddress']),
    outTradeNo: readString(root, ['out_trade_no', 'outTradeNo']),
    energyAmount: readNumber(root, ['energy_amount', 'energyAmount']),
    payAmount: readNumber(root, ['pay_amount', 'payAmount']),
    refundAmount: readNumber(root, ['refund_amount', 'refundAmount']),
    raw: root,
  };
};

export const mapItrxCallbackPayload = (payload: Record<string, unknown>): ItrxCallbackPayload => ({
  energyAmount: readNumber(payload, ['energy_amount', 'energyAmount']),
  payAmount: readNumber(payload, ['pay_amount', 'payAmount']),
  serial: readString(payload, ['serial']),
  txid: readString(payload, ['txid']),
  status: readNumber(payload, ['status']),
  type: readString(payload, ['type']),
  receiveAddress: readString(payload, ['receive_address', 'receiveAddress']),
  outTradeNo: readString(payload, ['out_trade_no', 'outTradeNo']),
  source: readString(payload, ['source']),
  rawPayload: payload,
});
