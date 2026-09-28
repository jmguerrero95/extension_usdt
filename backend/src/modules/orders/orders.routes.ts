import type { FastifyInstance } from 'fastify';

import { toOpenApiSchema } from '../../shared/validation/zod-json-schema';
import { validateRequest } from '../../shared/validation/validate-request';
import { requireApiKey } from '../auth/api-key.guard';
import {
  getInternalOrderController,
  listInternalOrdersController,
  markManualReviewController,
  reconcileOrderController,
  requestBuyEnergyController,
  requestEnergyController,
  requestForwardController,
  sendBuyController,
} from './orders.controller';
import {
  internalApiKeyHeaderSchema,
  internalEnergyResponseSchema,
  internalErrorResponseSchema,
  internalForwardResponseSchema,
  internalMarkManualReviewResponseSchema,
  internalOrderListQuerySchema,
  internalOrderListResponseSchema,
  internalOrderParamsSchema,
  internalOrderResponseSchema,
  internalReconcileResponseSchema,
  internalSendBuyResponseSchema,
  markManualReviewBodySchema,
} from './orders.schemas';

export const registerInternalOrderRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get(
    '/orders',
    {
      schema: {
        summary: 'Listar órdenes internas',
        description: 'Lista órdenes con filtros básicos para operación y soporte.',
        tags: ['Interno'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(internalApiKeyHeaderSchema),
        querystring: toOpenApiSchema(internalOrderListQuerySchema),
        response: {
          200: toOpenApiSchema(internalOrderListResponseSchema),
          401: toOpenApiSchema(internalErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('internal')],
      preValidation: validateRequest({
        headers: internalApiKeyHeaderSchema,
        query: internalOrderListQuerySchema,
      }),
      handler: listInternalOrdersController,
    },
  );

  app.get(
    '/orders/:orderId',
    {
      schema: {
        summary: 'Consultar orden interna',
        description: 'Devuelve el detalle interno completo de una orden.',
        tags: ['Interno'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(internalApiKeyHeaderSchema),
        params: toOpenApiSchema(internalOrderParamsSchema),
        response: {
          200: toOpenApiSchema(internalOrderResponseSchema),
          401: toOpenApiSchema(internalErrorResponseSchema),
          404: toOpenApiSchema(internalErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('internal')],
      preValidation: validateRequest({
        headers: internalApiKeyHeaderSchema,
        params: internalOrderParamsSchema,
      }),
      handler: getInternalOrderController,
    },
  );

  app.post(
    '/orders/:orderId/request-energy',
    {
      schema: {
        summary: 'Solicitar energía SELL',
        description:
          'Dispara manualmente la solicitud de energía para una orden SELL con depósito válido.',
        tags: ['Interno'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(internalApiKeyHeaderSchema),
        params: toOpenApiSchema(internalOrderParamsSchema),
        response: {
          202: toOpenApiSchema(internalEnergyResponseSchema),
          401: toOpenApiSchema(internalErrorResponseSchema),
          404: toOpenApiSchema(internalErrorResponseSchema),
          409: toOpenApiSchema(internalErrorResponseSchema),
          422: toOpenApiSchema(internalErrorResponseSchema),
          502: toOpenApiSchema(internalErrorResponseSchema),
          503: toOpenApiSchema(internalErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('internal')],
      preValidation: validateRequest({
        headers: internalApiKeyHeaderSchema,
        params: internalOrderParamsSchema,
      }),
      handler: requestEnergyController,
    },
  );

  app.post(
    '/orders/:orderId/request-buy-energy',
    {
      schema: {
        summary: 'Solicitar energía BUY',
        description:
          'Dispara manualmente la solicitud o reutilización de energía para la hot wallet emisora de una orden BUY.',
        tags: ['Interno'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(internalApiKeyHeaderSchema),
        params: toOpenApiSchema(internalOrderParamsSchema),
        response: {
          202: toOpenApiSchema(internalEnergyResponseSchema),
          401: toOpenApiSchema(internalErrorResponseSchema),
          404: toOpenApiSchema(internalErrorResponseSchema),
          409: toOpenApiSchema(internalErrorResponseSchema),
          422: toOpenApiSchema(internalErrorResponseSchema),
          502: toOpenApiSchema(internalErrorResponseSchema),
          503: toOpenApiSchema(internalErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('internal')],
      preValidation: validateRequest({
        headers: internalApiKeyHeaderSchema,
        params: internalOrderParamsSchema,
      }),
      handler: requestBuyEnergyController,
    },
  );

  app.post(
    '/orders/:orderId/forward',
    {
      schema: {
        summary: 'Solicitar forward SELL',
        description:
          'Dispara manualmente el forward desde la deposit address a la wallet central. Solo válido después de ENERGY_CONFIRMED.',
        tags: ['Interno'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(internalApiKeyHeaderSchema),
        params: toOpenApiSchema(internalOrderParamsSchema),
        response: {
          202: toOpenApiSchema(internalForwardResponseSchema),
          401: toOpenApiSchema(internalErrorResponseSchema),
          404: toOpenApiSchema(internalErrorResponseSchema),
          409: toOpenApiSchema(internalErrorResponseSchema),
          422: toOpenApiSchema(internalErrorResponseSchema),
          502: toOpenApiSchema(internalErrorResponseSchema),
          503: toOpenApiSchema(internalErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('internal')],
      preValidation: validateRequest({
        headers: internalApiKeyHeaderSchema,
        params: internalOrderParamsSchema,
      }),
      handler: requestForwardController,
    },
  );

  app.post(
    '/orders/:orderId/send-buy',
    {
      schema: {
        summary: 'Solicitar envío BUY',
        description:
          'Dispara manualmente el envío de USDT TRC20 desde la hot wallet central hacia la dirección destino del cliente. Solo válido después de ENERGY_CONFIRMED.',
        tags: ['Interno'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(internalApiKeyHeaderSchema),
        params: toOpenApiSchema(internalOrderParamsSchema),
        response: {
          202: toOpenApiSchema(internalSendBuyResponseSchema),
          401: toOpenApiSchema(internalErrorResponseSchema),
          404: toOpenApiSchema(internalErrorResponseSchema),
          409: toOpenApiSchema(internalErrorResponseSchema),
          422: toOpenApiSchema(internalErrorResponseSchema),
          502: toOpenApiSchema(internalErrorResponseSchema),
          503: toOpenApiSchema(internalErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('internal')],
      preValidation: validateRequest({
        headers: internalApiKeyHeaderSchema,
        params: internalOrderParamsSchema,
      }),
      handler: sendBuyController,
    },
  );

  app.post(
    '/orders/:orderId/reconcile',
    {
      schema: {
        summary: 'Reconciliar orden',
        description:
          'Reevalúa una orden, consulta el estado del proveedor si falta un webhook o callback y reencola el siguiente paso pendiente si aplica.',
        tags: ['Interno'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(internalApiKeyHeaderSchema),
        params: toOpenApiSchema(internalOrderParamsSchema),
        response: {
          202: toOpenApiSchema(internalReconcileResponseSchema),
          401: toOpenApiSchema(internalErrorResponseSchema),
          404: toOpenApiSchema(internalErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('internal')],
      preValidation: validateRequest({
        headers: internalApiKeyHeaderSchema,
        params: internalOrderParamsSchema,
      }),
      handler: reconcileOrderController,
    },
  );

  app.post(
    '/orders/:orderId/mark-manual-review',
    {
      schema: {
        summary: 'Marcar revisión manual',
        description: 'Marca una orden en ERROR_MANUAL_REVIEW y detiene la automatización.',
        tags: ['Interno'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(internalApiKeyHeaderSchema),
        params: toOpenApiSchema(internalOrderParamsSchema),
        body: toOpenApiSchema(markManualReviewBodySchema, {
          examples: [
            {
              reason: 'Depósito parcial fuera de política',
              metadata: {
                amount: 10.25,
              },
            },
          ],
        }),
        response: {
          200: toOpenApiSchema(internalMarkManualReviewResponseSchema),
          401: toOpenApiSchema(internalErrorResponseSchema),
          404: toOpenApiSchema(internalErrorResponseSchema),
          409: toOpenApiSchema(internalErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('internal')],
      preValidation: validateRequest({
        headers: internalApiKeyHeaderSchema,
        params: internalOrderParamsSchema,
        body: markManualReviewBodySchema,
      }),
      handler: markManualReviewController,
    },
  );
};
