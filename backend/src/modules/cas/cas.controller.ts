import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { buildSuccessResponse } from '../../shared/utils/api-response';
import { serializeTimeline } from '../../shared/dto/serializers';
import type {
  buyOrderParamsSchema,
  completeSellPayoutBodySchema,
  createBuyOrderBodySchema,
  createSellOrderBodySchema,
  sellOrderParamsSchema,
} from './cas.schemas';

export const createSellOrderController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const body = request.body as z.infer<typeof createSellOrderBodySchema>;
  const result = await request.server.services.ordersService.createSellOrder(body, {
    actorType: 'api',
    actorId: request.id,
  });

  reply.status(201).send(
    buildSuccessResponse(request.id, {
      orderId: result.order.orderId,
      status: result.order.status,
      depositAddress: result.order.depositAddress,
      qrPayload: result.qrPayload,
      expiresAt: result.order.expiresAt.toISOString(),
    }),
  );
};

export const createBuyOrderController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const body = request.body as z.infer<typeof createBuyOrderBodySchema>;
  const order = await request.server.services.ordersService.createBuyOrder(body, {
    actorType: 'api',
    actorId: request.id,
  });

  reply.status(201).send(
    buildSuccessResponse(request.id, {
      orderId: order.orderId,
      type: order.type,
      status: order.status,
      customerDestinationAddress: order.customerDestinationAddress,
      cryptoAmountToSend: order.cryptoAmountToSend,
      fiatAmount: order.fiatAmount,
      updatedAt: order.updatedAt.toISOString(),
    }),
  );
};

export const getSellOrderController = async (request: FastifyRequest, reply: FastifyReply) => {
  const { orderId } = request.params as z.infer<typeof sellOrderParamsSchema>;
  const order = await request.server.services.ordersService.getCasSellOrder(orderId);

  reply.send(buildSuccessResponse(request.id, order));
};

export const getBuyOrderController = async (request: FastifyRequest, reply: FastifyReply) => {
  const { orderId } = request.params as z.infer<typeof buyOrderParamsSchema>;
  const order = await request.server.services.ordersService.getCasBuyOrder(orderId);

  reply.send(buildSuccessResponse(request.id, order));
};

export const getSellOrderTimelineController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { orderId } = request.params as z.infer<typeof sellOrderParamsSchema>;
  const timeline = await request.server.services.auditService.getTimeline(orderId);

  reply.send(buildSuccessResponse(request.id, serializeTimeline(timeline)));
};

export const getBuyOrderTimelineController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { orderId } = request.params as z.infer<typeof buyOrderParamsSchema>;
  const timeline = await request.server.services.auditService.getTimeline(orderId);

  reply.send(buildSuccessResponse(request.id, serializeTimeline(timeline)));
};

export const cancelSellOrderController = async (request: FastifyRequest, reply: FastifyReply) => {
  const { orderId } = request.params as z.infer<typeof sellOrderParamsSchema>;
  const order = await request.server.services.ordersService.cancelSellOrder(orderId, {
    actorType: 'api',
    actorId: request.id,
  });

  reply.send(
    buildSuccessResponse(request.id, {
      orderId: order.orderId,
      status: order.status,
      updatedAt: order.updatedAt.toISOString(),
    }),
  );
};

export const cancelBuyOrderController = async (request: FastifyRequest, reply: FastifyReply) => {
  const { orderId } = request.params as z.infer<typeof buyOrderParamsSchema>;
  const order = await request.server.services.ordersService.cancelBuyOrder(orderId, {
    actorType: 'api',
    actorId: request.id,
  });

  reply.send(
    buildSuccessResponse(request.id, {
      orderId: order.orderId,
      status: order.status,
      updatedAt: order.updatedAt.toISOString(),
    }),
  );
};

export const completeSellPayoutController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { orderId } = request.params as z.infer<typeof sellOrderParamsSchema>;
  const body = request.body as z.infer<typeof completeSellPayoutBodySchema>;
  const order = await request.server.services.ordersService.completeSellPayout(
    orderId,
    body,
    {
      actorType: 'api',
      actorId: request.id,
    },
  );

  reply.send(
    buildSuccessResponse(request.id, {
      orderId: order.orderId,
      status: 'COMPLETED',
      updatedAt: order.updatedAt.toISOString(),
    }),
  );
};
