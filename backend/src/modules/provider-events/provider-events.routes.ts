import type { FastifyInstance } from 'fastify';

import { toOpenApiSchema } from '../../shared/validation/zod-json-schema';
import { validateRequest } from '../../shared/validation/validate-request';
import { requireApiKey } from '../auth/api-key.guard';
import { reprocessProviderEventController } from './provider-events.controller';
import {
  internalApiKeyHeaderSchema,
  internalErrorResponseSchema,
  internalEventParamsSchema,
  internalReprocessResponseSchema,
} from '../orders/orders.schemas';

export const registerInternalProviderEventRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post(
    '/provider-events/:eventId/reprocess',
    {
      schema: {
        summary: 'Reprocesar evento de proveedor',
        description: 'Reintenta el procesamiento de un evento persistido en `provider_events`.',
        tags: ['Interno'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(internalApiKeyHeaderSchema),
        params: toOpenApiSchema(internalEventParamsSchema),
        response: {
          202: toOpenApiSchema(internalReprocessResponseSchema),
          401: toOpenApiSchema(internalErrorResponseSchema),
          404: toOpenApiSchema(internalErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('internal')],
      preValidation: validateRequest({
        headers: internalApiKeyHeaderSchema,
        params: internalEventParamsSchema,
      }),
      handler: reprocessProviderEventController,
    },
  );
};
