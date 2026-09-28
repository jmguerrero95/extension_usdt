import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from './app-error';
import { buildErrorResponse } from '../../shared/utils/api-response';
import { DomainError } from '../../domain/errors/domain-error';

export const registerErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler(
    (error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof AppError) {
        request.log.warn(
          {
            code: error.code,
            details: error.details,
          },
          error.message,
        );

        reply.status(error.statusCode).send(
          buildErrorResponse(request.id, error.code, error.message, error.details),
        );

        return;
      }

      if (error instanceof DomainError) {
        request.log.warn(
          {
            code: error.code,
            details: error.details,
          },
          error.message,
        );

        reply.status(error.statusCode).send(
          buildErrorResponse(request.id, error.code, error.message, error.details),
        );

        return;
      }

      request.log.error(
        {
          err: error,
        },
        'Error no controlado',
      );

      reply.status(500).send(
        buildErrorResponse(
          request.id,
          'INTERNAL_ERROR',
          app.config.nodeEnv === 'production'
            ? 'Ocurrió un error interno inesperado.'
            : error.message,
          app.config.nodeEnv === 'production' ? null : { stack: error.stack },
        ),
      );
    },
  );
};
