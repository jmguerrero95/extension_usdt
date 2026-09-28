import type { AppConfig } from '../../../app/config/env';
import { sha256 } from '../../../shared/utils/hash';
import type {
  CryptoCurrencyApiForwardParams,
  CryptoCurrencyApiGiveParams,
  CryptoCurrencyApiNormalizedWebhook,
  CryptoCurrencyApiRequestStatusResult,
  CryptoCurrencyApiSendParams,
} from './cryptocurrencyapi.types';
import {
  mapForwardResponse,
  mapGiveResponse,
  mapRequestStatusResponse,
  mapSendResponse,
  normalizeCryptoCurrencyApiWebhookPayload,
  parseProviderResponse,
} from './cryptocurrencyapi.mapper';
import type { CryptoCurrencyApiClient } from './cryptocurrencyapi.client';
import { CryptoCurrencyApiBadResponseError } from './cryptocurrencyapi.errors';

interface BuildGiveParamsInput {
  providerUniqId: string;
  providerLabel: string;
  waitPeriod: number;
  period: number;
}

interface BuildForwardParamsInput {
  orderId: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
}

interface BuildSendParamsInput {
  orderId: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
}

export type CryptoCurrencyApiStatusLookupField = 'requestId' | 'uniqID' | 'label';

interface RequestStatusLookupOptions {
  lookupOrder?: CryptoCurrencyApiStatusLookupField[];
  fallbackOnInvoiceNotFound?: boolean;
}

interface RequestStatusLookupResult {
  lookupField: CryptoCurrencyApiStatusLookupField;
  status: CryptoCurrencyApiRequestStatusResult;
}

export class CryptoCurrencyApiService {
  public constructor(
    private readonly client: CryptoCurrencyApiClient,
    private readonly config: AppConfig,
  ) {}

  public buildGiveParams(input: BuildGiveParamsInput): CryptoCurrencyApiGiveParams {
    return {
      uniqID: input.providerUniqId,
      statusURL: `${this.config.apiBaseUrl}/api/v1/webhooks/cryptocurrencyapi`,
      waitPeriod: input.waitPeriod,
      period: input.period,
      label: input.providerLabel,
      token: this.config.tron.usdtTokenSymbol,
    };
  }

  public buildForwardParams(input: BuildForwardParamsInput): CryptoCurrencyApiForwardParams {
    return {
      from: input.fromAddress,
      to: input.toAddress,
      amount: input.amount,
      token: this.config.tron.usdtTokenSymbol,
      statusURL: `${this.config.apiBaseUrl}/api/v1/webhooks/cryptocurrencyapi`,
      label: `forward|${input.orderId}`,
      uniqID: `forward_${input.orderId}`,
    };
  }

  public buildSendParams(input: BuildSendParamsInput): CryptoCurrencyApiSendParams {
    return {
      from: input.fromAddress,
      to: input.toAddress,
      amount: input.amount,
      token: this.config.tron.usdtTokenSymbol,
      statusURL: `${this.config.apiBaseUrl}/api/v1/webhooks/cryptocurrencyapi`,
      label: `send|${input.orderId}`,
      uniqID: `send_${input.orderId}`,
    };
  }

  public async giveDepositAddress(params: CryptoCurrencyApiGiveParams) {
    const response = await this.client.giveDepositAddress(params);
    return mapGiveResponse(response);
  }

  public async forwardFunds(params: CryptoCurrencyApiForwardParams) {
    const response = await this.client.forwardFunds(params);
    return mapForwardResponse(response);
  }

  public async sendPreparedForward(params: CryptoCurrencyApiForwardParams) {
    const response = await this.client.sendFunds(params);
    return mapSendResponse(response);
  }

  public async sendFunds(params: CryptoCurrencyApiSendParams) {
    const response = await this.client.sendFunds(params);
    return mapSendResponse(response);
  }

  public async getRequestStatus(input: {
    requestId?: string | null;
    label?: string | null;
    uniqID?: string | null;
  }, options?: RequestStatusLookupOptions): Promise<CryptoCurrencyApiRequestStatusResult> {
    const result = await this.getRequestStatusWithLookup(input, options);
    return result.status;
  }

  public async getRequestStatusWithLookup(
    input: {
      requestId?: string | null;
      label?: string | null;
      uniqID?: string | null;
    },
    options?: RequestStatusLookupOptions,
  ): Promise<RequestStatusLookupResult> {
    const lookupOrder = (options?.lookupOrder ?? ['requestId', 'uniqID', 'label']).filter((field) =>
      this.hasLookupValue(input, field),
    );

    let lastError: unknown = null;

    for (const lookupField of lookupOrder) {
      try {
        const response = await this.client.getRequestStatus(this.buildStatusParams(input, lookupField));
        return {
          lookupField,
          status: mapRequestStatusResponse(response),
        };
      } catch (error) {
        lastError = error;

        if (
          !options?.fallbackOnInvoiceNotFound ||
          !this.isInvoiceNotFoundError(error) ||
          lookupField === lookupOrder[lookupOrder.length - 1]
        ) {
          throw error;
        }
      }
    }

    if (lastError) {
      if (lastError instanceof Error) {
        throw lastError;
      }

      throw new CryptoCurrencyApiBadResponseError(
        'CryptoCurrencyAPI devolvio un error no interpretable.',
        lastError,
      );
    }

    const response = await this.client.getRequestStatus({});
    return {
      lookupField: 'requestId',
      status: mapRequestStatusResponse(response),
    };
  }

  public normalizeWebhookPayload(payload: Record<string, unknown>): CryptoCurrencyApiNormalizedWebhook {
    return normalizeCryptoCurrencyApiWebhookPayload(payload);
  }

  public normalizeSendWebhookPayload(
    payload: Record<string, unknown>,
  ): CryptoCurrencyApiNormalizedWebhook {
    return normalizeCryptoCurrencyApiWebhookPayload(payload);
  }

  public parseProviderResponse(payload: unknown): Record<string, unknown> {
    return parseProviderResponse(payload);
  }

  public buildEventKey(rawBody: string | null, payload: Record<string, unknown>): string {
    return sha256(
      `cryptocurrencyapi|${rawBody ?? JSON.stringify(payload, Object.keys(payload).sort())}`,
    );
  }

  private buildStatusParams(
    input: {
      requestId?: string | null;
      label?: string | null;
      uniqID?: string | null;
    },
    lookupField: CryptoCurrencyApiStatusLookupField,
  ): {
    id?: string;
    label?: string;
    uniqID?: string;
  } {
    if (lookupField === 'requestId' && input.requestId) {
      return { id: input.requestId };
    }

    if (lookupField === 'uniqID' && input.uniqID) {
      return { uniqID: input.uniqID };
    }

    if (lookupField === 'label' && input.label) {
      return { label: input.label };
    }

    return {};
  }

  private hasLookupValue(
    input: {
      requestId?: string | null;
      label?: string | null;
      uniqID?: string | null;
    },
    lookupField: CryptoCurrencyApiStatusLookupField,
  ): boolean {
    if (lookupField === 'requestId') {
      return Boolean(input.requestId);
    }

    if (lookupField === 'uniqID') {
      return Boolean(input.uniqID);
    }

    return Boolean(input.label);
  }

  private isInvoiceNotFoundError(error: unknown): boolean {
    if (!(error instanceof CryptoCurrencyApiBadResponseError)) {
      return false;
    }

    if (typeof error.details === 'string') {
      return error.details.toLowerCase().includes('invoice_not_found');
    }

    try {
      return JSON.stringify(error.details).toLowerCase().includes('invoice_not_found');
    } catch {
      return false;
    }
  }
}
