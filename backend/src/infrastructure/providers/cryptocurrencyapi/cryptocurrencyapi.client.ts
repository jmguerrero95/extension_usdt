import type { AxiosInstance } from 'axios';
import { AxiosError } from 'axios';

import type {
  CryptoCurrencyApiForwardParams,
  CryptoCurrencyApiGiveParams,
  CryptoCurrencyApiSendParams,
} from './cryptocurrencyapi.types';
import {
  CryptoCurrencyApiBadResponseError,
  CryptoCurrencyApiTimeoutError,
} from './cryptocurrencyapi.errors';

export class CryptoCurrencyApiClient {
  public constructor(
    private readonly httpClient: AxiosInstance,
    private readonly apiKey: string,
  ) {}

  public async giveDepositAddress(params: CryptoCurrencyApiGiveParams): Promise<unknown> {
    return this.request('/api/trx/.give', params as unknown as Record<string, unknown>);
  }

  public async forwardFunds(params: CryptoCurrencyApiForwardParams): Promise<unknown> {
    return this.request('/api/trx/.forward', params as unknown as Record<string, unknown>);
  }

  public async sendFunds(params: CryptoCurrencyApiSendParams): Promise<unknown> {
    return this.request('/api/trx/.send', params as unknown as Record<string, unknown>);
  }

  public async getRequestStatus(params: {
    id?: string;
    label?: string;
    uniqID?: string;
  }): Promise<unknown> {
    return this.request('/api/trx/.status', params as unknown as Record<string, unknown>);
  }

  private async request(path: string, params: Record<string, unknown>): Promise<unknown> {
    try {
      const response = await this.httpClient.get(path, {
        params: {
          key: this.apiKey,
          ...params,
        },
      });

      if (response.status >= 500) {
        throw new CryptoCurrencyApiBadResponseError(
          'CryptoCurrencyAPI respondió con un error temporal.',
          {
            status: response.status,
            data: response.data,
          },
        );
      }

      if (response.status >= 400) {
        throw new CryptoCurrencyApiBadResponseError(
          'CryptoCurrencyAPI respondió con un error inválido.',
          {
            status: response.status,
            data: response.data,
          },
        );
      }

      return response.data;
    } catch (error) {
      if (error instanceof CryptoCurrencyApiBadResponseError) {
        throw error;
      }

      if (error instanceof AxiosError && error.code === 'ECONNABORTED') {
        throw new CryptoCurrencyApiTimeoutError();
      }

      throw new CryptoCurrencyApiBadResponseError(
        'No fue posible comunicarse con CryptoCurrencyAPI.',
        error,
      );
    }
  }
}
