import type { FastifyInstance } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';

import type { AppConfig } from '../config/env';

export const registerRawBodyPlugin = async (
  app: FastifyInstance,
  _config: AppConfig,
): Promise<void> => {
  await app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
    routes: [],
    jsonContentTypes: ['application/json'],
  });
};
