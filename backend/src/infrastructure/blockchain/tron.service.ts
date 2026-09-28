import { createHash } from 'node:crypto';

import type { AxiosInstance } from 'axios';

export interface TronUsdtTransfer {
  txid: string;
  from: string | null;
  to: string | null;
  amount: number;
  timestamp: number | null;
}

export interface TronUsdtTransferByTxid extends TronUsdtTransfer {
  confirmed: boolean;
  confirmations: number | null;
  blockNumber: number | null;
}

export interface TronAccountResources {
  energyLimit: number;
  energyUsed: number;
  availableEnergy: number;
  freeNetLimit: number;
  freeNetUsed: number;
  netLimit: number;
  netUsed: number;
  availableBandwidth: number;
}

const TRONGRID_BASE_URL = 'https://api.trongrid.io';
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRON_ADDRESS_PREFIX = '41';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export class TronService {
  public static readonly baseUrl = TRONGRID_BASE_URL;

  public constructor(private readonly httpClient: AxiosInstance) {}

  public async getUSDTTransfers(
    address: string,
    limit = 20,
    options?: { onlyConfirmed?: boolean },
  ): Promise<TronUsdtTransfer[]> {
    const response = await this.httpClient.get(`/v1/accounts/${address}/transactions/trc20`, {
      params: {
        limit,
        only_confirmed: options?.onlyConfirmed ?? true,
        contract_address: USDT_TRC20_CONTRACT,
      },
    });

    if (response.status >= 400) {
      throw new Error(`TronGrid devolvio un estado ${response.status} al consultar transfers TRC20.`);
    }

    const root =
      typeof response.data === 'object' && response.data !== null
        ? (response.data as Record<string, unknown>)
        : {};
    const data = Array.isArray(root['data']) ? root['data'] : [];

    return data
      .map((entry) => this.mapTransfer(entry))
      .filter((entry): entry is TronUsdtTransfer => entry !== null);
  }

  public async findConfirmedUSDTTransferByTxid(
    address: string,
    txid: string,
    limit = 100,
  ): Promise<TronUsdtTransfer | null> {
    const transfers = await this.getUSDTTransfers(address, limit);
    return transfers.find((transfer) => transfer.txid === txid) ?? null;
  }

  public async getUSDTTransferByTxid(txid: string): Promise<TronUsdtTransferByTxid | null> {
    const response = await this.httpClient.get(`/v1/transactions/${txid}/events`);

    if (response.status >= 400) {
      throw new Error(`TronGrid devolvio un estado ${response.status} al consultar la tx ${txid}.`);
    }

    const root =
      typeof response.data === 'object' && response.data !== null
        ? (response.data as Record<string, unknown>)
        : {};
    const data = Array.isArray(root['data']) ? root['data'] : [];
    const transfer = data
      .map((entry) => this.mapTransferEventByTxid(txid, entry))
      .find((entry): entry is TronUsdtTransferByTxid => entry !== null);

    if (!transfer) {
      return null;
    }

    if (!transfer.confirmed || transfer.blockNumber === null) {
      return transfer;
    }

    const latestBlockNumber = await this.getLatestBlockNumber();
    if (latestBlockNumber === null || latestBlockNumber < transfer.blockNumber) {
      return transfer;
    }

    return {
      ...transfer,
      confirmations: latestBlockNumber - transfer.blockNumber + 1,
    };
  }

  public async getAccountResources(address: string): Promise<TronAccountResources> {
    const response = await this.httpClient.post('/wallet/getaccountresource', {
      address,
      visible: true,
    });

    if (response.status >= 400) {
      throw new Error(`TronGrid devolvio un estado ${response.status} al consultar recursos.`);
    }

    const root =
      typeof response.data === 'object' && response.data !== null
        ? (response.data as Record<string, unknown>)
        : {};
    const energyLimit = this.readFiniteNumber(root['EnergyLimit']);
    const energyUsed = this.readFiniteNumber(root['EnergyUsed']);
    const freeNetLimit = this.readFiniteNumber(root['freeNetLimit']);
    const freeNetUsed = this.readFiniteNumber(root['freeNetUsed']);
    const netLimit = this.readFiniteNumber(root['NetLimit']);
    const netUsed = this.readFiniteNumber(root['NetUsed']);

    return {
      energyLimit,
      energyUsed,
      availableEnergy: Math.max(0, energyLimit - energyUsed),
      freeNetLimit,
      freeNetUsed,
      netLimit,
      netUsed,
      availableBandwidth: Math.max(0, freeNetLimit - freeNetUsed) + Math.max(0, netLimit - netUsed),
    };
  }

  public normalizeAddress(value: unknown): string | null {
    return this.normalizeTronAddress(value);
  }

  private mapTransfer(value: unknown): TronUsdtTransfer | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const tokenInfo =
      typeof record['token_info'] === 'object' && record['token_info'] !== null
        ? (record['token_info'] as Record<string, unknown>)
        : null;

    const symbol = typeof tokenInfo?.['symbol'] === 'string' ? tokenInfo['symbol'].toUpperCase() : null;
    const tokenAddress =
      typeof tokenInfo?.['address'] === 'string' ? tokenInfo['address'] : null;

    if (symbol !== 'USDT' || tokenAddress !== USDT_TRC20_CONTRACT) {
      return null;
    }

    const decimalsRaw = tokenInfo?.['decimals'];
    const decimals =
      typeof decimalsRaw === 'number'
        ? decimalsRaw
        : typeof decimalsRaw === 'string'
          ? Number(decimalsRaw)
          : 6;

    const valueRaw = record['value'];
    const amountBaseUnits =
      typeof valueRaw === 'number'
        ? valueRaw
        : typeof valueRaw === 'string'
          ? Number(valueRaw)
          : Number.NaN;

    if (!Number.isFinite(amountBaseUnits)) {
      return null;
    }

    const timestampRaw = record['block_timestamp'];
    const timestamp =
      typeof timestampRaw === 'number'
        ? timestampRaw
        : typeof timestampRaw === 'string'
          ? Number(timestampRaw)
          : null;
    const txid = typeof record['transaction_id'] === 'string' ? record['transaction_id'] : null;

    if (!txid) {
      return null;
    }

    return {
      txid,
      from: typeof record['from'] === 'string' ? record['from'] : null,
      to: typeof record['to'] === 'string' ? record['to'] : null,
      amount: amountBaseUnits / 10 ** (Number.isFinite(decimals) ? decimals : 6),
      timestamp: Number.isFinite(timestamp ?? Number.NaN) ? (timestamp as number) : null,
    };
  }

  private async getLatestBlockNumber(): Promise<number | null> {
    const response = await this.httpClient.post('/wallet/getnowblock', {});

    if (response.status >= 400) {
      throw new Error(`TronGrid devolvio un estado ${response.status} al consultar el ultimo bloque.`);
    }

    const root =
      typeof response.data === 'object' && response.data !== null
        ? (response.data as Record<string, unknown>)
        : {};
    const blockHeader =
      typeof root['block_header'] === 'object' && root['block_header'] !== null
        ? (root['block_header'] as Record<string, unknown>)
        : null;
    const rawData =
      typeof blockHeader?.['raw_data'] === 'object' && blockHeader['raw_data'] !== null
        ? (blockHeader['raw_data'] as Record<string, unknown>)
        : null;
    const numberRaw = rawData?.['number'];
    const blockNumber =
      typeof numberRaw === 'number'
        ? numberRaw
        : typeof numberRaw === 'string'
          ? Number(numberRaw)
          : Number.NaN;

    return Number.isFinite(blockNumber) ? blockNumber : null;
  }

  private mapTransferEventByTxid(txid: string, value: unknown): TronUsdtTransferByTxid | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const eventNameRaw = record['event_name'] ?? record['event'];
    const eventName =
      typeof eventNameRaw === 'string' ? eventNameRaw.toLowerCase() : null;
    if (eventName !== 'transfer') {
      return null;
    }

    const contractAddress = this.normalizeTronAddress(record['contract_address']);
    const callerContractAddress = this.normalizeTronAddress(record['caller_contract_address']);
    if (
      contractAddress !== USDT_TRC20_CONTRACT &&
      callerContractAddress !== USDT_TRC20_CONTRACT
    ) {
      return null;
    }

    const result =
      typeof record['result'] === 'object' && record['result'] !== null
        ? (record['result'] as Record<string, unknown>)
        : null;

    const from = this.normalizeTronAddress(
      result?.['from'] ?? result?.['_from'] ?? result?.['src'] ?? result?.['0'],
    );
    const to = this.normalizeTronAddress(
      result?.['to'] ?? result?.['_to'] ?? result?.['dst'] ?? result?.['1'],
    );
    const valueRaw = result?.['value'] ?? result?.['_value'] ?? result?.['amount'] ?? result?.['2'];
    const amountBaseUnits =
      typeof valueRaw === 'number'
        ? valueRaw
        : typeof valueRaw === 'string'
          ? Number(valueRaw)
          : Number.NaN;

    if (!Number.isFinite(amountBaseUnits)) {
      return null;
    }

    const timestampRaw = record['block_timestamp'] ?? record['timestamp'];
    const timestamp =
      typeof timestampRaw === 'number'
        ? timestampRaw
        : typeof timestampRaw === 'string'
          ? Number(timestampRaw)
          : null;

    const blockNumberRaw = record['block_number'];
    const blockNumber =
      typeof blockNumberRaw === 'number'
        ? blockNumberRaw
        : typeof blockNumberRaw === 'string'
          ? Number(blockNumberRaw)
          : Number.NaN;

    const unconfirmedRaw = record['_unconfirmed'] ?? record['unconfirmed'];
    const confirmed =
      typeof unconfirmedRaw === 'boolean'
        ? !unconfirmedRaw
        : typeof blockNumberRaw !== 'undefined';

    return {
      txid,
      from,
      to,
      amount: amountBaseUnits / 10 ** 6,
      timestamp: Number.isFinite(timestamp ?? Number.NaN) ? (timestamp as number) : null,
      confirmed,
      confirmations: confirmed ? 1 : 0,
      blockNumber: Number.isFinite(blockNumber) ? blockNumber : null,
    };
  }

  private normalizeTronAddress(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith('T')) {
      return trimmed;
    }

    const normalizedHex = this.normalizeTronHexAddress(trimmed);
    if (!normalizedHex) {
      return null;
    }

    return this.encodeTronBase58Address(normalizedHex);
  }

  private readFiniteNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return 0;
  }

  private normalizeTronHexAddress(value: string): string | null {
    const compact = value.replace(/^0x/i, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(compact)) {
      return null;
    }

    if (compact.length === 40) {
      return `${TRON_ADDRESS_PREFIX}${compact}`;
    }

    if (compact.length === 42 && compact.startsWith(TRON_ADDRESS_PREFIX.toLowerCase())) {
      return compact;
    }

    return null;
  }

  private encodeTronBase58Address(hexAddress: string): string {
    const payload = Buffer.from(hexAddress, 'hex');
    const checksum = this.sha256(this.sha256(payload)).subarray(0, 4);
    return this.encodeBase58(Buffer.concat([payload, checksum]));
  }

  private encodeBase58(value: Uint8Array): string {
    let numericValue = BigInt(`0x${Buffer.from(value).toString('hex')}`);
    let encoded = '';

    while (numericValue > 0n) {
      const remainder = Number(numericValue % 58n);
      encoded = `${BASE58_ALPHABET[remainder]}${encoded}`;
      numericValue /= 58n;
    }

    for (const byte of value) {
      if (byte !== 0) {
        break;
      }

      encoded = `1${encoded}`;
    }

    return encoded || '1';
  }

  private sha256(value: Uint8Array): Buffer {
    return createHash('sha256').update(value).digest();
  }
}
