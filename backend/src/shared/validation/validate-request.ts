import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { ZodError, type ZodTypeAny } from 'zod';

import { AppError } from '../../app/errors/app-error';
import { formatZodError } from './zod-error';

type RequestSchemaMap = Partial<{
  body: ZodTypeAny;
  params: ZodTypeAny;
  query: ZodTypeAny;
  headers: ZodTypeAny;
}>;

export const validateRequest =
  (schemas: RequestSchemaMap) =>
  (request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction): void => {
    try {
      if (schemas.body) {
        request.body = schemas.body.parse(request.body);
      }

      if (schemas.params) {
        request.params = schemas.params.parse(request.params);
      }

      if (schemas.query) {
        request.query = schemas.query.parse(request.query);
      }

      if (schemas.headers) {
        request.headers = schemas.headers.parse(request.headers) as typeof request.headers;
      }

      done();
    } catch (error) {
      if (error instanceof ZodError) {
        done(
          new AppError({
            code: 'VALIDATION_ERROR',
            statusCode: 400,
            message: 'La solicitud no cumple las validaciones requeridas.',
            details: formatZodError(error),
          }),
        );

        return;
      }

      done(error as Error);
    }
  };
