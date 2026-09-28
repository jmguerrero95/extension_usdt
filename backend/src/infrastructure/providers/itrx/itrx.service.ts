import type { IncomingHttpHeaders } from 'node:http';

import type { AppConfig } from '../../../app/config/env';
import { sha256 } from '../../../shared/utils/hash';
import {
  mapAutoDelegateResponse,
  mapCollectionManualResponse,
  mapEstimatedPriceResponse,
  mapItrxCallbackPayload,
  mapOneOffOrderResponse,
  mapOrderQueryResponse,
  mapSmartDelegatePolicyQueryResponse,
} from './itrx.mapper';
import type {
  ItrxAutoDelegateParams,
  ItrxCallbackPayload,
  ItrxCollectionManualParams,
  ItrxOneOffOrderParams,
} from './itrx.types';
import { canonicalizeJsonForSignature, verifyItrxCallbackSignature } from './itrx.signature';
import type { ItrxClient } from './itrx.client';

export class ItrxService {
  public constructor(
    private readonly client: ItrxClient,
    private readonly config: AppConfig,
  ) {}

  public async estimateEnergyForUsdtTransfer(input?: { toAddress?: string }) {
    const response = await this.client.estimateEnergyForUsdtTransfer({
      period: this.config.energy.rentalPeriod,
      to_address: input?.toAddress ?? this.config.tron.forwardTargetAddress,
    });

    return mapEstimatedPriceResponse(response);
  }

  public async createOrUpdateSmartDelegatePolicy(input: {
    receiveAddress: string;
    maxEnergy: number;
    outTradeNo: string;
  }) {
    const body: ItrxAutoDelegateParams = {
      period: this.config.energy.smartDelegateDays,
      receive_address: input.receiveAddress,
      max_energy: input.maxEnergy,
      callback_url: `${this.config.apiBaseUrl}/api/v1/webhooks/itrx`,
      out_trade_no: input.outTradeNo,
    };

    const response = await this.client.createOrUpdateSmartDelegatePolicy(body);
    return {
      requestBody: body,
      response: mapAutoDelegateResponse(response),
    };
  }

  public async createCollectionOrder(input: {
    receiveAddress: string;
    toAddress: string;
    outTradeNo: string;
  }) {
    const body: ItrxCollectionManualParams = {
      scene: 0,
      receive_address: input.receiveAddress,
      to_address: input.toAddress,
      callback_url: `${this.config.apiBaseUrl}/api/v1/webhooks/itrx`,
      out_trade_no: input.outTradeNo,
    };

    const response = await this.client.createCollectionOrder(body);
    return {
      requestBody: body,
      response: mapCollectionManualResponse(response),
    };
  }

  public async createOneOffEnergyOrder(input: {
    receiveAddress: string;
    energyAmount: number;
    outTradeNo: string;
  }) {
    const body: ItrxOneOffOrderParams = {
      energy_amount: input.energyAmount,
      period: this.config.energyBuy.oneOffPeriod,
      receive_address: input.receiveAddress,
      active: 0,
      exclusive: 0,
      callback_url: `${this.config.apiBaseUrl}/api/v1/webhooks/itrx`,
      out_trade_no: input.outTradeNo,
    };

    const response = await this.client.createOneOffEnergyOrder(body);
    return {
      requestBody: body,
      response: mapOneOffOrderResponse(response),
    };
  }

  public async queryOrder(input: {
    serial?: string | null;
    outTradeNo?: string | null;
  }) {
    const response = await this.client.queryOrder({
      ...(input.serial ? { serial: input.serial } : {}),
      ...(input.outTradeNo ? { out_trade_no: input.outTradeNo } : {}),
    });

    return mapOrderQueryResponse(response);
  }

  public async querySmartDelegatePolicy(input: { receiveAddress: string }) {
    const response = await this.client.querySmartDelegatePolicy({
      receive_address: input.receiveAddress,
    });

    return mapSmartDelegatePolicyQueryResponse(response);
  }

  public async changeSmartDelegatePolicyStatus(input: { id: number; status: number }) {
    const response = await this.client.changeSmartDelegatePolicyStatus(input.id, {
      status: input.status,
    });

    return mapAutoDelegateResponse(response);
  }

  public verifyCallbackSignature(
    headers: IncomingHttpHeaders,
    payload: Record<string, unknown>,
  ): boolean {
    return verifyItrxCallbackSignature(this.config.providers.itrx.apiSecret, headers, payload);
  }

  public canonicalizeJsonForSignature(payload: Record<string, unknown>): string {
    return canonicalizeJsonForSignature(payload);
  }

  public normalizeCallbackPayload(payload: Record<string, unknown>): ItrxCallbackPayload {
    return mapItrxCallbackPayload(payload);
  }

  public isCallbackTimestampFresh(timestamp: string): boolean {
    const timestampSec = Number(timestamp);
    if (Number.isNaN(timestampSec)) {
      return false;
    }

    const age = Math.floor(Date.now() / 1_000) - timestampSec;
    return age <= this.config.providers.itrx.callbackMaxAgeSec;
  }

  public buildEventKey(rawBody: string | null, payload: Record<string, unknown>): string {
    return sha256(`itrx|${rawBody ?? canonicalizeJsonForSignature(payload)}`);
  }
}
