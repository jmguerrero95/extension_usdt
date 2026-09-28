import { z } from 'zod';

import {
  energyRequestSchema,
  errorResponseSchema,
  forwardRequestSchema,
  internalOrderSchema,
  providerEventSchema,
  sendRequestSchema,
  successEnvelopeSchema,
} from '../../app/docs/schemas';

export const internalApiKeyHeaderSchema = z.object({
  'x-api-key': z.string().min(1),
});

export const internalOrderParamsSchema = z.object({
  orderId: z.string().min(1),
});

export const internalEventParamsSchema = z.object({
  eventId: z.string().min(1),
});

export const internalOrderListQuerySchema = z.object({
  status: z.string().optional(),
  terminalId: z.string().optional(),
  externalRef: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
});

export const markManualReviewBodySchema = z.object({
  reason: z.string().min(3),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const internalOrderResponseSchema = successEnvelopeSchema(internalOrderSchema);
export const internalOrderListResponseSchema = successEnvelopeSchema(z.array(internalOrderSchema));
export const internalEnergyResponseSchema = successEnvelopeSchema(
  z.object({
    order: internalOrderSchema,
    energyRequest: energyRequestSchema.nullable(),
    skipped: z.boolean(),
  }),
);
export const internalForwardResponseSchema = successEnvelopeSchema(
  z.object({
    order: internalOrderSchema,
    forwardRequest: forwardRequestSchema.nullable(),
    skipped: z.boolean(),
  }),
);
export const internalSendBuyResponseSchema = successEnvelopeSchema(
  z.object({
    order: internalOrderSchema,
    sendRequest: sendRequestSchema.nullable(),
    skipped: z.boolean(),
  }),
);
export const internalReconcileResponseSchema = successEnvelopeSchema(
  z.object({
    order: internalOrderSchema,
    actions: z.array(z.string()),
  }),
);
export const internalReprocessResponseSchema = successEnvelopeSchema(providerEventSchema.nullable());
export const internalMarkManualReviewResponseSchema = successEnvelopeSchema(internalOrderSchema);
export const internalErrorResponseSchema = errorResponseSchema;
