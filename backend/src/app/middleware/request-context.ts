import { randomUUID } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { HEADER_NAMES } from '../../shared/constants/headers';

export const buildRequestId = (request: FastifyRequest): string => {
  const incomingRequestId = request.headers[HEADER_NAMES.REQUEST_ID];
  return typeof incomingRequestId === 'string' && incomingRequestId.trim() !== ''
    ? incomingRequestId
    : randomUUID();
};

export const requestContextHook = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  reply.header(HEADER_NAMES.REQUEST_ID, request.id);
};
