/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { AxiosInstance } from 'axios';
import { AxiosError } from 'axios';

import type {
  ItrxAutoDelegateParams,
  ItrxCollectionManualParams,
  ItrxOneOffOrderParams,
} from './itrx.types';
import {
  buildItrxSignatureFromCanonicalJson,
  canonicalizeJsonForSignature,
} from './itrx.signature';
import { ItrxBadResponseError, ItrxTimeoutError } from './itrx.errors';

export class ItrxClient {
  public constructor(
    private readonly httpClient: AxiosInstance,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  public async estimateEnergyForUsdtTransfer(params: {
    period: string;
    to_address: string;
  }): Promise<unknown> {
    try {
      const response = await this.httpClient.get('/api/v1/frontend/order/price', {
        params,
        headers: {
          'API-KEY': this.apiKey,
        },
      });

      if (response.status >= 500) {
        throw new ItrxBadResponseError('iTRX respondiÃ³ con un error temporal.', {
          status: response.status,
          data: response.data,
        });
      }

      if (response.status >= 400) {
        throw new ItrxBadResponseError('iTRX respondiÃ³ con un error invÃ¡lido.', {
          status: response.status,
          data: response.data,
        });
      }

      return response.data;
    } catch (error) {
      if (error instanceof ItrxBadResponseError) {
        throw error;
      }

      if (error instanceof AxiosError && error.code === 'ECONNABORTED') {
        throw new ItrxTimeoutError();
      }

      throw new ItrxBadResponseError('No fue posible comunicarse con iTRX.', error);
    }
  }

  public async queryOrder(params: {
    serial?: string;
    out_trade_no?: string;
  }): Promise<unknown> {
    try {
      const response = await this.httpClient.get('/api/v1/frontend/order/query', {
        params,
        headers: {
          'API-KEY': this.apiKey,
        },
      });

      if (response.status >= 500) {
        throw new ItrxBadResponseError('iTRX respondio con un error temporal.', {
          status: response.status,
          data: response.data,
        });
      }

      if (response.status >= 400) {
        throw new ItrxBadResponseError('iTRX respondio con un error invalido.', {
          status: response.status,
          data: response.data,
        });
      }

      return response.data;
    } catch (error) {
      if (error instanceof ItrxBadResponseError) {
        throw error;
      }

      if (error instanceof AxiosError && error.code === 'ECONNABORTED') {
        throw new ItrxTimeoutError();
      }

      throw new ItrxBadResponseError('No fue posible comunicarse con iTRX.', error);
    }
  }

  public async querySmartDelegatePolicy(params: {
    receive_address: string;
  }): Promise<unknown> {
    try {
      const response = await this.httpClient.get('/api/v1/frontend/auto-delegate-policy', {
        params,
        headers: {
          'API-KEY': this.apiKey,
        },
      });

      if (response.status >= 500) {
        throw new ItrxBadResponseError('iTRX respondio con un error temporal.', {
          status: response.status,
          data: response.data,
          endpoint: '/api/v1/frontend/auto-delegate-policy',
        });
      }

      if (response.status >= 400) {
        throw new ItrxBadResponseError('iTRX respondio con un error invalido.', {
          status: response.status,
          data: response.data,
          endpoint: '/api/v1/frontend/auto-delegate-policy',
        });
      }

      return response.data;
    } catch (error) {
      if (error instanceof ItrxBadResponseError) {
        throw error;
      }

      if (error instanceof AxiosError && error.code === 'ECONNABORTED') {
        throw new ItrxTimeoutError();
      }

      throw new ItrxBadResponseError('No fue posible comunicarse con iTRX.', {
        endpoint: '/api/v1/frontend/auto-delegate-policy',
        cause: error,
      });
    }
  }

  public async createOrUpdateSmartDelegatePolicy(body: ItrxAutoDelegateParams): Promise<unknown> {
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const endpoint = '/api/v1/frontend/auto-delegate-policy';
    const serializedBody = canonicalizeJsonForSignature(body);
    const signature = buildItrxSignatureFromCanonicalJson(
      this.apiSecret,
      timestamp,
      serializedBody,
    );

    try {
      const response = await this.httpClient.post(endpoint, serializedBody, {
        headers: {
          'API-KEY': this.apiKey,
          TIMESTAMP: timestamp,
          SIGNATURE: signature,
          'Content-Type': 'application/json',
        },
      });

      if (response.status >= 500) {
        throw new ItrxBadResponseError('iTRX respondiÃ³ con un error temporal.', {
          status: response.status,
          data: response.data,
          endpoint,
        });
      }

      if (response.status >= 400) {
        throw new ItrxBadResponseError('iTRX respondiÃ³ con un error invÃ¡lido.', {
          status: response.status,
          data: response.data,
          endpoint,
        });
      }

      if (typeof response.data !== 'object' || response.data === null) {
        throw new ItrxBadResponseError('iTRX devolviÃ³ una respuesta sin body JSON interpretable.', {
          status: response.status,
          errno: null,
          data: response.data,
          endpoint,
        });
      }

      const errnoValue = (response.data as Record<string, unknown>)['errno'];
      const errno =
        typeof errnoValue === 'number'
          ? errnoValue
          : typeof errnoValue === 'string'
            ? Number(errnoValue)
            : Number.NaN;

      if (!Number.isFinite(errno)) {
        throw new ItrxBadResponseError('iTRX devolviÃ³ una respuesta sin errno vÃ¡lido.', {
          status: response.status,
          errno: null,
          data: response.data,
          endpoint,
        });
      }

      if (errno !== 0) {
        throw new ItrxBadResponseError('iTRX devolviÃ³ errno distinto de 0.', {
          status: response.status,
          errno,
          data: response.data,
          endpoint,
        });
      }

      return response.data;
    } catch (error) {
      if (error instanceof ItrxBadResponseError) {
        throw error;
      }

      if (error instanceof AxiosError && error.code === 'ECONNABORTED') {
        throw new ItrxTimeoutError();
      }

      throw new ItrxBadResponseError('No fue posible comunicarse con iTRX.', {
        endpoint,
        cause: error,
      });
    }
  }

  public async createOneOffEnergyOrder(body: ItrxOneOffOrderParams): Promise<unknown> {
    return this.postSignedJson('/api/v1/frontend/order', body);
  }

  public async changeSmartDelegatePolicyStatus(id: number, body: { status: number }): Promise<unknown> {
    return this.postSignedJson(`/api/v1/frontend/auto-delegate-policy/${id}/change-status`, body);
  }

  public async createCollectionOrder(body: ItrxCollectionManualParams): Promise<unknown> {
    return this.postSignedJson('/api/v1/frontend/order/collect-manual', body);
  }

  private async postSignedJson(endpoint: string, body: object): Promise<unknown> {
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const serializedBody = canonicalizeJsonForSignature(body);
    const signature = buildItrxSignatureFromCanonicalJson(
      this.apiSecret,
      timestamp,
      serializedBody,
    );

    try {
      const response = await this.httpClient.post(endpoint, serializedBody, {
        headers: {
          'API-KEY': this.apiKey,
          TIMESTAMP: timestamp,
          SIGNATURE: signature,
          'Content-Type': 'application/json',
        },
      });

      if (response.status >= 500) {
        throw new ItrxBadResponseError('iTRX respondió con un error temporal.', {
          status: response.status,
          data: response.data,
          endpoint,
        });
      }

      if (response.status >= 400) {
        throw new ItrxBadResponseError('iTRX respondió con un error inválido.', {
          status: response.status,
          data: response.data,
          endpoint,
        });
      }

      if (typeof response.data !== 'object' || response.data === null) {
        throw new ItrxBadResponseError('iTRX devolvió una respuesta sin body JSON interpretable.', {
          status: response.status,
          errno: null,
          data: response.data,
          endpoint,
        });
      }

      const errnoValue = (response.data as Record<string, unknown>)['errno'];
      const errno =
        typeof errnoValue === 'number'
          ? errnoValue
          : typeof errnoValue === 'string'
            ? Number(errnoValue)
            : Number.NaN;

      if (!Number.isFinite(errno)) {
        throw new ItrxBadResponseError('iTRX devolvió una respuesta sin errno válido.', {
          status: response.status,
          errno: null,
          data: response.data,
          endpoint,
        });
      }

      if (errno !== 0) {
        throw new ItrxBadResponseError('iTRX devolvió errno distinto de 0.', {
          status: response.status,
          errno,
          data: response.data,
          endpoint,
        });
      }

      return response.data;
    } catch (error) {
      if (error instanceof ItrxBadResponseError) {
        throw error;
      }

      if (error instanceof AxiosError && error.code === 'ECONNABORTED') {
        throw new ItrxTimeoutError();
      }

      throw new ItrxBadResponseError('No fue posible comunicarse con iTRX.', {
        endpoint,
        cause: error,
      });
    }
  }
}
