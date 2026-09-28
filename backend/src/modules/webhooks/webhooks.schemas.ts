import { z } from 'zod';

import { errorResponseSchema, providerEventSchema, successEnvelopeSchema } from '../../app/docs/schemas';

export const webhookAckResponseSchema = successEnvelopeSchema(
  z.object({
    accepted: z.boolean(),
    duplicate: z.boolean(),
    event: providerEventSchema.nullable(),
  }),
);

export const webhookErrorResponseSchema = errorResponseSchema;
