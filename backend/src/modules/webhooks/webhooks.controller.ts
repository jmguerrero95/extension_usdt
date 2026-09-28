import type { FastifyReply, FastifyRequest } from 'fastify';

import { serializeProviderEvent } from '../../shared/dto/serializers';
import { buildSuccessResponse } from '../../shared/utils/api-response';

export const cryptocurrencyApiWebhookController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const result = await request.server.services.providerEventsService.handleCryptoCurrencyApiWebhook({
    payload: request.body as Record<string, unknown>,
    rawBody: typeof request.rawBody === 'string' ? request.rawBody : null,
    request,
  });

  reply.send(
    buildSuccessResponse(request.id, {
      accepted: true,
      duplicate: result.duplicate,
      event: serializeProviderEvent(result.event ?? null),
    }),
  );
};

export const itrxWebhookController = async (request: FastifyRequest, reply: FastifyReply) => {
  const result = await request.server.services.providerEventsService.handleItrxWebhook({
    payload: request.body as Record<string, unknown>,
    rawBody: typeof request.rawBody === 'string' ? request.rawBody : null,
    request,
  });

  reply.send(
    buildSuccessResponse(request.id, {
      accepted: true,
      duplicate: result.duplicate,
      event: serializeProviderEvent(result.event ?? null),
    }),
  );
};
