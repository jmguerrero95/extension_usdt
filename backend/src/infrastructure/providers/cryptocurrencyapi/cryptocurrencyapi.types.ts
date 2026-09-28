export interface CryptoCurrencyApiGiveParams {
  uniqID: string;
  statusURL: string;
  waitPeriod: number;
  period: number;
  label: string;
  token: string;
  qr?: number;
}

export interface CryptoCurrencyApiForwardParams {
  from: string;
  to: string;
  amount: number;
  token: string;
  statusURL: string;
  label: string;
  uniqID: string;
}

export interface CryptoCurrencyApiSendParams {
  from: string;
  to: string;
  amount: number;
  token: string;
  statusURL: string;
  label: string;
  uniqID: string;
}

export interface CryptoCurrencyApiGiveResult {
  address: string;
  publicKey: string | null;
  privateKey: string | null;
  requestId: string | null;
  raw: Record<string, unknown>;
}

export interface CryptoCurrencyApiForwardResult {
  providerRequestId: string;
  raw: Record<string, unknown>;
}

export interface CryptoCurrencyApiSendResult {
  providerRequestId: string;
  raw: Record<string, unknown>;
}

export interface CryptoCurrencyApiRequestStatusResult {
  requestId: string | null;
  label: string | null;
  uniqID: string | null;
  txid: string | null;
  token: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  amount: number | null;
  state: number | null;
  result: string | null;
  raw: Record<string, unknown>;
}

export interface CryptoCurrencyApiNormalizedWebhook {
  eventType: 'deposit' | 'forward' | 'send' | 'unknown';
  address: string | null;
  label: string | null;
  uniqID: string | null;
  txid: string | null;
  token: string | null;
  network: string | null;
  amount: number | null;
  confirmations: number | null;
  status: string | null;
  requestId: string | null;
  rawPayload: Record<string, unknown>;
}
