import type { FastifyInstance } from 'fastify';

import { toOpenApiSchema } from '../../shared/validation/zod-json-schema';
import { webhookAckResponseSchema, webhookErrorResponseSchema } from './webhooks.schemas';
import { cryptocurrencyApiWebhookController, itrxWebhookController } from './webhooks.controller';

export const registerWebhookRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post(
    '/cryptocurrencyapi',
    {
      config: {
        rawBody: true,
      },
      schema: {
        summary: 'Webhook de CryptoCurrencyAPI',
        description:
          'Recibe eventos idempotentes de depósito y barrido/forward desde CryptoCurrencyAPI. Conserva raw body y persiste el evento antes de procesar negocio.',
        tags: ['Webhooks'],
        response: {
          200: toOpenApiSchema(webhookAckResponseSchema),
          403: toOpenApiSchema(webhookErrorResponseSchema),
          404: toOpenApiSchema(webhookErrorResponseSchema),
        },
      },
      handler: cryptocurrencyApiWebhookController,
    },
  );

  app.post(
    '/itrx',
    {
      config: {
        rawBody: true,
      },
      schema: {
        summary: 'Webhook de iTRX',
        description:
          'Recibe callbacks firmados de iTRX, valida timestamp y firma HMAC, persiste el evento y confirma energía sobre la orden correlacionada.',
        tags: ['Webhooks'],
        response: {
          200: toOpenApiSchema(webhookAckResponseSchema),
          401: toOpenApiSchema(webhookErrorResponseSchema),
          403: toOpenApiSchema(webhookErrorResponseSchema),
          404: toOpenApiSchema(webhookErrorResponseSchema),
        },
      },
      handler: itrxWebhookController,
    },
  );
};
