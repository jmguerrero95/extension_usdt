import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import type { AppConfig } from '../config/env';

export const registerSecurityPlugins = async (
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> => {
  await app.register(helmet);

  await app.register(cors, {
    origin:
      config.security.corsOrigins.length === 0
        ? true
        : config.security.corsOrigins,
  });

  await app.register(rateLimit, {
    max: config.security.rateLimitMax,
    timeWindow: config.security.rateLimitWindowMs,
  });
};
