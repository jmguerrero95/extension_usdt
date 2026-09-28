import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { serializeProviderEvent } from '../../shared/dto/serializers';
import { buildSuccessResponse } from '../../shared/utils/api-response';
import { internalEventParamsSchema } from '../orders/orders.schemas';

export const reprocessProviderEventController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { eventId } = request.params as z.infer<typeof internalEventParamsSchema>;
  const event = await request.server.services.providerEventsService.enqueueManualReprocessEvent(eventId);

  reply.status(202).send(buildSuccessResponse(request.id, serializeProviderEvent(event)));
};
