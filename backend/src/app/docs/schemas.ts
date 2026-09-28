import { z } from 'zod';

import { ORDER_STATUSES } from '../../domain/enums/order-status';

export const requestMetaSchema = z.object({
  requestId: z.string(),
});

export const successEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: requestMetaSchema,
  });

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().nullable(),
  }),
  meta: requestMetaSchema,
});

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const sellCasOrderSchema = z.object({
  orderId: z.string(),
  status: orderStatusSchema,
  cryptoAmountExpected: z.number().nullable(),
  cryptoAmountReceived: z.number().nullable(),
  depositAddress: z.string().nullable(),
  forwardTxid: z.string().nullable(),
  manualReviewRequired: z.boolean(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const buyCasOrderSchema = z.object({
  orderId: z.string(),
  type: z.literal('BUY'),
  status: orderStatusSchema,
  cryptoAmountToSend: z.number().nullable(),
  customerDestinationAddress: z.string().nullable(),
  providerRequestId: z.string().nullable(),
  sendTxid: z.string().nullable(),
  manualReviewRequired: z.boolean(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const casOrderSchema = sellCasOrderSchema;

export const internalSellOrderSchema = z.object({
  orderId: z.string(),
  externalRef: z.string().nullable(),
  terminalId: z.string().nullable(),
  type: z.literal('SELL'),
  asset: z.literal('USDT'),
  network: z.literal('TRON'),
  fiatCurrency: z.literal('COP'),
  fiatAmount: z.number(),
  cryptoAmountExpected: z.number().nullable(),
  cryptoAmountReceived: z.number().nullable(),
  cryptoAmountToSend: z.null(),
  depositAddress: z.string().nullable(),
  providerUniqId: z.string(),
  providerLabel: z.string(),
  providerForwardRequestId: z.string().nullable(),
  providerForwardTxid: z.string().nullable(),
  providerSendRequestId: z.null(),
  providerSendTxid: z.null(),
  customerDestinationAddress: z.null(),
  buySenderAddress: z.null(),
  forwardTargetAddress: z.string().nullable(),
  status: orderStatusSchema,
  statusReason: z.string().nullable(),
  expiresAt: z.string().datetime(),
  depositDetectedAt: z.string().datetime().nullable(),
  cashPayoutEligibleAt: z.string().datetime().nullable().optional(),
  cashPayoutConfirmedAt: z.string().datetime().nullable().optional(),
  cashPayoutCasTransactionId: z.string().nullable().optional(),
  cashPayoutTerminalId: z.string().nullable().optional(),
  energyEstimatedAt: z.string().datetime().nullable(),
  energyRequestedAt: z.string().datetime().nullable(),
  energyConfirmedAt: z.string().datetime().nullable(),
  forwardRequestedAt: z.string().datetime().nullable(),
  sweepConfirmedAt: z.string().datetime().nullable(),
  settlementCompletedAt: z.string().datetime().nullable().optional(),
  sendRequestedAt: z.null(),
  sendConfirmedAt: z.null(),
  completedAt: z.string().datetime().nullable(),
  manualReviewRequired: z.boolean(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const internalBuyOrderSchema = z.object({
  orderId: z.string(),
  externalRef: z.string().nullable(),
  terminalId: z.string().nullable(),
  type: z.literal('BUY'),
  asset: z.literal('USDT'),
  network: z.literal('TRON'),
  fiatCurrency: z.literal('COP'),
  fiatAmount: z.number(),
  cryptoAmountExpected: z.null(),
  cryptoAmountReceived: z.null(),
  cryptoAmountToSend: z.number().nullable(),
  depositAddress: z.null(),
  providerUniqId: z.string(),
  providerLabel: z.string(),
  providerForwardRequestId: z.null(),
  providerForwardTxid: z.null(),
  providerSendRequestId: z.string().nullable(),
  providerSendTxid: z.string().nullable(),
  customerDestinationAddress: z.string().nullable(),
  buySenderAddress: z.string().nullable(),
  forwardTargetAddress: z.null(),
  status: orderStatusSchema,
  statusReason: z.string().nullable(),
  expiresAt: z.string().datetime(),
  depositDetectedAt: z.null(),
  energyEstimatedAt: z.string().datetime().nullable(),
  energyRequestedAt: z.string().datetime().nullable(),
  energyConfirmedAt: z.string().datetime().nullable(),
  forwardRequestedAt: z.null(),
  sweepConfirmedAt: z.null(),
  sendRequestedAt: z.string().datetime().nullable(),
  sendConfirmedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  manualReviewRequired: z.boolean(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const internalOrderSchema = z.discriminatedUnion('type', [
  internalSellOrderSchema,
  internalBuyOrderSchema,
]);

export const providerEventSchema = z.object({
  id: z.string(),
  provider: z.enum(['cryptocurrencyapi', 'itrx']),
  eventType: z.string(),
  eventKey: z.string(),
  orderId: z.string().nullable(),
  signatureValid: z.boolean().nullable(),
  processed: z.boolean(),
  processedAt: z.string().datetime().nullable(),
  error: z.unknown().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const energyRequestSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  provider: z.literal('itrx'),
  mode: z.enum(['estimated', 'fixed']),
  energyContext: z.enum(['SELL_DEPOSIT', 'BUY_SENDER']),
  estimatedEnergyAmount: z.number().nullable(),
  requestedEnergyAmount: z.number(),
  safetyMultiplier: z.number(),
  period: z.union([z.string(), z.number()]),
  receiveAddress: z.string(),
  callbackUrl: z.string().nullable(),
  providerSerial: z.string().nullable(),
  status: z.string(),
  signatureValid: z.boolean().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const forwardRequestSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  provider: z.literal('cryptocurrencyapi'),
  fromAddress: z.string(),
  toAddress: z.string(),
  token: z.string(),
  amount: z.number(),
  providerRequestId: z.string().nullable(),
  txid: z.string().nullable(),
  status: z.string(),
  requestedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const sendRequestSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  provider: z.literal('cryptocurrencyapi'),
  fromAddress: z.string(),
  toAddress: z.string(),
  token: z.string(),
  amount: z.number(),
  providerRequestId: z.string().nullable(),
  txid: z.string().nullable(),
  status: z.string(),
  requestedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const timelineItemSchema = z.object({
  type: z.enum(['state_transition', 'provider_event']),
  occurredAt: z.string().datetime(),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()),
});

export const timelineResponseSchema = z.array(timelineItemSchema);
