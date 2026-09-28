import type { FastifyInstance } from 'fastify';

import { toOpenApiSchema } from '../../shared/validation/zod-json-schema';
import { validateRequest } from '../../shared/validation/validate-request';
import { requireApiKey } from '../auth/api-key.guard';
import {
  buyOrderParamsSchema,
  cancelBuyOrderResponseSchema,
  cancelSellOrderResponseSchema,
  casApiKeyHeaderSchema,
  casErrorResponseSchema,
  completeSellPayoutBodySchema,
  completeSellPayoutResponseSchema,
  createBuyOrderBodySchema,
  createBuyOrderResponseSchema,
  createSellOrderBodySchema,
  createSellOrderResponseSchema,
  getBuyOrderResponseSchema,
  getSellOrderResponseSchema,
  sellOrderParamsSchema,
  timelineResponseEnvelopeSchema,
} from './cas.schemas';
import {
  cancelBuyOrderController,
  cancelSellOrderController,
  completeSellPayoutController,
  createBuyOrderController,
  createSellOrderController,
  getBuyOrderController,
  getBuyOrderTimelineController,
  getSellOrderController,
  getSellOrderTimelineController,
} from './cas.controller';

export const registerCasRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post(
    '/sell-orders',
    {
      schema: {
        summary: 'Crear orden SELL',
        description:
          'Crea una orden SELL USDT TRC20 por COP, solicita una deposit address a CryptoCurrencyAPI y deja la orden en WAITING_DEPOSIT.',
        tags: ['CAS'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(casApiKeyHeaderSchema),
        body: toOpenApiSchema(createSellOrderBodySchema, {
          examples: [
            {
              asset: 'USDT',
              network: 'TRON',
              fiatCurrency: 'COP',
              fiatAmount: 100000,
              cryptoAmountExpected: 24.12,
              externalRef: 'cas-tx-123',
              terminalId: 'batm-001',
            },
          ],
        }),
        response: {
          201: toOpenApiSchema(createSellOrderResponseSchema),
          400: toOpenApiSchema(casErrorResponseSchema),
          401: toOpenApiSchema(casErrorResponseSchema),
          409: toOpenApiSchema(casErrorResponseSchema),
          502: toOpenApiSchema(casErrorResponseSchema),
          503: toOpenApiSchema(casErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('cas')],
      preValidation: validateRequest({
        headers: casApiKeyHeaderSchema,
        body: createSellOrderBodySchema,
      }),
      handler: createSellOrderController,
    },
  );

  app.post(
    '/buy-orders',
    {
      schema: {
        summary: 'Crear orden BUY',
        description:
          'Crea una orden BUY USDT TRC20 por COP, registra la wallet destino del cliente y deja el flujo listo para preparar energía y envío asíncrono.',
        tags: ['CAS'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(casApiKeyHeaderSchema),
        body: toOpenApiSchema(createBuyOrderBodySchema, {
          examples: [
            {
              asset: 'USDT',
              network: 'TRON',
              fiatCurrency: 'COP',
              fiatAmount: 100000,
              cryptoAmountToSend: 24.12,
              customerDestinationAddress: 'TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ',
              externalRef: 'cas-tx-buy-123',
              terminalId: 'batm-001',
            },
          ],
        }),
        response: {
          201: toOpenApiSchema(createBuyOrderResponseSchema),
          400: toOpenApiSchema(casErrorResponseSchema),
          401: toOpenApiSchema(casErrorResponseSchema),
          409: toOpenApiSchema(casErrorResponseSchema),
          422: toOpenApiSchema(casErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('cas')],
      preValidation: validateRequest({
        headers: casApiKeyHeaderSchema,
        body: createBuyOrderBodySchema,
      }),
      handler: createBuyOrderController,
    },
  );

  app.get(
    '/sell-orders/:orderId',
    {
      schema: {
        summary: 'Consultar orden SELL',
        description: 'Devuelve el estado resumido de una orden SELL para consumo de CAS.',
        tags: ['CAS'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(casApiKeyHeaderSchema),
        params: toOpenApiSchema(sellOrderParamsSchema),
        response: {
          200: toOpenApiSchema(getSellOrderResponseSchema),
          401: toOpenApiSchema(casErrorResponseSchema),
          404: toOpenApiSchema(casErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('cas')],
      preValidation: validateRequest({
        headers: casApiKeyHeaderSchema,
        params: sellOrderParamsSchema,
      }),
      handler: getSellOrderController,
    },
  );

  app.get(
    '/buy-orders/:orderId',
    {
      schema: {
        summary: 'Consultar orden BUY',
        description: 'Devuelve el estado resumido de una orden BUY para consumo de CAS.',
        tags: ['CAS'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(casApiKeyHeaderSchema),
        params: toOpenApiSchema(buyOrderParamsSchema),
        response: {
          200: toOpenApiSchema(getBuyOrderResponseSchema),
          401: toOpenApiSchema(casErrorResponseSchema),
          404: toOpenApiSchema(casErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('cas')],
      preValidation: validateRequest({
        headers: casApiKeyHeaderSchema,
        params: buyOrderParamsSchema,
      }),
      handler: getBuyOrderController,
    },
  );

  app.get(
    '/sell-orders/:orderId/timeline',
    {
      schema: {
        summary: 'Timeline de orden SELL',
        description:
          'Devuelve transiciones de estado y eventos resumidos del proveedor, ordenados por fecha.',
        tags: ['CAS'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(casApiKeyHeaderSchema),
        params: toOpenApiSchema(sellOrderParamsSchema),
        response: {
          200: toOpenApiSchema(timelineResponseEnvelopeSchema),
          401: toOpenApiSchema(casErrorResponseSchema),
          404: toOpenApiSchema(casErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('cas')],
      preValidation: validateRequest({
        headers: casApiKeyHeaderSchema,
        params: sellOrderParamsSchema,
      }),
      handler: getSellOrderTimelineController,
    },
  );

  app.get(
    '/buy-orders/:orderId/timeline',
    {
      schema: {
        summary: 'Timeline de orden BUY',
        description:
          'Devuelve transiciones de estado y eventos resumidos del proveedor, ordenados por fecha.',
        tags: ['CAS'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(casApiKeyHeaderSchema),
        params: toOpenApiSchema(buyOrderParamsSchema),
        response: {
          200: toOpenApiSchema(timelineResponseEnvelopeSchema),
          401: toOpenApiSchema(casErrorResponseSchema),
          404: toOpenApiSchema(casErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('cas')],
      preValidation: validateRequest({
        headers: casApiKeyHeaderSchema,
        params: buyOrderParamsSchema,
      }),
      handler: getBuyOrderTimelineController,
    },
  );

  app.post(
    '/sell-orders/:orderId/cancel',
    {
      schema: {
        summary: 'Cancelar orden SELL',
        description:
          'Cancela explícitamente una orden SELL en espera de depósito. Una orden con depósito detectado o superior ya no puede cancelarse.',
        tags: ['CAS'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(casApiKeyHeaderSchema),
        params: toOpenApiSchema(sellOrderParamsSchema),
        response: {
          200: toOpenApiSchema(cancelSellOrderResponseSchema),
          401: toOpenApiSchema(casErrorResponseSchema),
          404: toOpenApiSchema(casErrorResponseSchema),
          409: toOpenApiSchema(casErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('cas')],
      preValidation: validateRequest({
        headers: casApiKeyHeaderSchema,
        params: sellOrderParamsSchema,
      }),
      handler: cancelSellOrderController,
    },
  );

  app.post(
    '/buy-orders/:orderId/cancel',
    {
      schema: {
        summary: 'Cancelar orden BUY',
        description:
          'Cancela explícitamente una orden BUY mientras el envío aún no ha sido solicitado a CryptoCurrencyAPI.',
        tags: ['CAS'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(casApiKeyHeaderSchema),
        params: toOpenApiSchema(buyOrderParamsSchema),
        response: {
          200: toOpenApiSchema(cancelBuyOrderResponseSchema),
          401: toOpenApiSchema(casErrorResponseSchema),
          404: toOpenApiSchema(casErrorResponseSchema),
          409: toOpenApiSchema(casErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('cas')],
      preValidation: validateRequest({
        headers: casApiKeyHeaderSchema,
        params: buyOrderParamsSchema,
      }),
      handler: cancelBuyOrderController,
    },
  );

  app.post(
    '/sell-orders/:orderId/complete-payout',
    {
      schema: {
        summary: 'Confirmar payout SELL en CAS',
        description:
          'Marca una orden SELL como COMPLETED cuando CAS confirma que el efectivo ya fue entregado al cliente. Requiere correlaciÃ³n con el transaction id de CAS y solo aplica desde READY_FOR_PAYOUT.',
        tags: ['CAS'],
        security: [{ ApiKeyAuth: [] }],
        headers: toOpenApiSchema(casApiKeyHeaderSchema),
        params: toOpenApiSchema(sellOrderParamsSchema),
        body: toOpenApiSchema(completeSellPayoutBodySchema, {
          examples: [
            {
              casTransactionId: 'cas-tx-123',
              terminalId: 'batm-001',
            },
          ],
        }),
        response: {
          200: toOpenApiSchema(completeSellPayoutResponseSchema),
          400: toOpenApiSchema(casErrorResponseSchema),
          401: toOpenApiSchema(casErrorResponseSchema),
          404: toOpenApiSchema(casErrorResponseSchema),
          409: toOpenApiSchema(casErrorResponseSchema),
        },
      },
      preHandler: [requireApiKey('cas')],
      preValidation: validateRequest({
        headers: casApiKeyHeaderSchema,
        params: sellOrderParamsSchema,
        body: completeSellPayoutBodySchema,
      }),
      handler: completeSellPayoutController,
    },
  );
};
