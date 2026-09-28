import { z } from 'zod';

import {
  buyCasOrderSchema,
  errorResponseSchema,
  sellCasOrderSchema,
  successEnvelopeSchema,
  timelineResponseSchema,
} from '../../app/docs/schemas';
import { isValidTronAddress } from '../../shared/utils/tron-address';

export const casApiKeyHeaderSchema = z.object({
  'x-api-key': z.string().min(1),
});

export const sellOrderParamsSchema = z.object({
  orderId: z.string().min(1),
});

export const buyOrderParamsSchema = z.object({
  orderId: z.string().min(1),
});

export const createSellOrderBodySchema = z.object({
  asset: z.literal('USDT'),
  network: z.literal('TRON'),
  fiatCurrency: z.literal('COP'),
  fiatAmount: z.number().positive(),
  cryptoAmountExpected: z.number().positive().optional(),
  externalRef: z.string().min(1).optional(),
  terminalId: z.string().min(1).optional(),
});

export const createBuyOrderBodySchema = z.object({
  asset: z.literal('USDT'),
  network: z.literal('TRON'),
  fiatCurrency: z.literal('COP'),
  fiatAmount: z.number().positive(),
  cryptoAmountToSend: z.number().positive(),
  customerDestinationAddress: z
    .string()
    .min(1)
    .refine(isValidTronAddress, 'La dirección TRON destino no tiene un formato válido.'),
  externalRef: z.string().min(1).optional(),
  terminalId: z.string().min(1).optional(),
});

export const completeSellPayoutBodySchema = z.object({
  casTransactionId: z.string().min(1),
  terminalId: z.string().min(1).optional(),
});

export const createSellOrderResponseSchema = successEnvelopeSchema(
  z.object({
    orderId: z.string(),
    status: z.literal('WAITING_DEPOSIT'),
    depositAddress: z.string(),
    qrPayload: z.string(),
    expiresAt: z.string().datetime(),
  }),
);

export const createBuyOrderResponseSchema = successEnvelopeSchema(
  z.object({
    orderId: z.string(),
    type: z.literal('BUY'),
    status: z.literal('CREATED'),
    customerDestinationAddress: z.string(),
    cryptoAmountToSend: z.number(),
    fiatAmount: z.number(),
    updatedAt: z.string().datetime(),
  }),
);

export const getSellOrderResponseSchema = successEnvelopeSchema(sellCasOrderSchema);
export const getBuyOrderResponseSchema = successEnvelopeSchema(buyCasOrderSchema);

export const timelineResponseEnvelopeSchema = successEnvelopeSchema(timelineResponseSchema);

export const cancelSellOrderResponseSchema = successEnvelopeSchema(
  z.object({
    orderId: z.string(),
    status: z.literal('CANCELED'),
    updatedAt: z.string().datetime(),
  }),
);

export const cancelBuyOrderResponseSchema = successEnvelopeSchema(
  z.object({
    orderId: z.string(),
    status: z.literal('CANCELED'),
    updatedAt: z.string().datetime(),
  }),
);

export const completeSellPayoutResponseSchema = successEnvelopeSchema(
  z.object({
    orderId: z.string(),
    status: z.literal('COMPLETED'),
    updatedAt: z.string().datetime(),
  }),
);

export const casErrorResponseSchema = errorResponseSchema;
