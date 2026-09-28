import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../../app/errors/app-error';

export const requireApiKey =
  (scope: 'cas' | 'internal') =>
  async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const providedKey = request.headers['x-api-key'];
    const expectedKey = scope === 'cas' ? request.server.config.apiKeys.cas : request.server.config.apiKeys.internal;

    if (typeof providedKey !== 'string' || providedKey !== expectedKey) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'La API key enviada no es válida para este recurso.',
      });
    }
  };
