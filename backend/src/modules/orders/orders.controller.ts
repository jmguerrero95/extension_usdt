import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type {
  internalOrderListQuerySchema,
  internalOrderParamsSchema,
  markManualReviewBodySchema,
} from './orders.schemas';

import {
  serializeEnergyRequest,
  serializeForwardRequest,
  serializeOrder,
  serializeSendRequest,
} from '../../shared/dto/serializers';
import { buildSuccessResponse } from '../../shared/utils/api-response';

export const listInternalOrdersController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as z.infer<typeof internalOrderListQuerySchema>;
  const orders = await request.server.services.ordersService.listOrders(query);

  reply.send(buildSuccessResponse(request.id, orders.map(serializeOrder)));
};

export const getInternalOrderController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { orderId } = request.params as z.infer<typeof internalOrderParamsSchema>;
  const order = await request.server.services.ordersService.getInternalOrder(orderId);

  reply.send(buildSuccessResponse(request.id, serializeOrder(order)));
};

export const requestEnergyController = async (request: FastifyRequest, reply: FastifyReply) => {
  const { orderId } = request.params as z.infer<typeof internalOrderParamsSchema>;
  const result = await request.server.services.energyService.requestEnergy(orderId, {
    actorType: 'internal',
    actorId: request.id,
  });

  reply.status(202).send(
    buildSuccessResponse(request.id, {
      order: serializeOrder(result.order),
      energyRequest: serializeEnergyRequest(result.energyRequest ?? null),
      skipped: result.skipped,
    }),
  );
};

export const requestBuyEnergyController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { orderId } = request.params as z.infer<typeof internalOrderParamsSchema>;
  const result = await request.server.services.energyService.requestBuyEnergy(orderId, {
      actorType: 'internal',
      actorId: request.id,
    });

  reply.status(202).send(
    buildSuccessResponse(request.id, {
      order: serializeOrder(result.order),
      energyRequest: serializeEnergyRequest(result.energyRequest ?? null),
      skipped: result.skipped,
    }),
  );
};

export const requestForwardController = async (request: FastifyRequest, reply: FastifyReply) => {
  const { orderId } = request.params as z.infer<typeof internalOrderParamsSchema>;
  const result = await request.server.services.forwardsService.requestForward(orderId, {
    actorType: 'internal',
    actorId: request.id,
  });

  reply.status(202).send(
    buildSuccessResponse(request.id, {
      order: serializeOrder(result.order),
      forwardRequest: serializeForwardRequest(result.forwardRequest ?? null),
      skipped: result.skipped,
    }),
  );
};

export const sendBuyController = async (request: FastifyRequest, reply: FastifyReply) => {
  const { orderId } = request.params as z.infer<typeof internalOrderParamsSchema>;
  const result = await request.server.services.forwardsService.requestBuySend(orderId, {
    actorType: 'internal',
    actorId: request.id,
  });

  reply.status(202).send(
    buildSuccessResponse(request.id, {
      order: serializeOrder(result.order),
      sendRequest: serializeSendRequest(result.sendRequest ?? null),
      skipped: result.skipped,
    }),
  );
};

export const reconcileOrderController = async (request: FastifyRequest, reply: FastifyReply) => {
  const { orderId } = request.params as z.infer<typeof internalOrderParamsSchema>;
  const result = await request.server.services.reconciliationService.reconcileOrder(orderId, {
    actorType: 'internal',
    actorId: request.id,
  });

  reply.status(202).send(
    buildSuccessResponse(request.id, {
      order: serializeOrder(result.order),
      actions: result.actions,
    }),
  );
};

export const markManualReviewController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { orderId } = request.params as z.infer<typeof internalOrderParamsSchema>;
  const body = request.body as z.infer<typeof markManualReviewBodySchema>;
  const order = await request.server.services.ordersService.markManualReview(
    orderId,
    {
      actorType: 'internal',
      actorId: request.id,
    },
    body.reason,
    body.metadata,
  );

  reply.send(buildSuccessResponse(request.id, serializeOrder(order)));
};
