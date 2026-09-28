import type { FastifyInstance } from 'fastify';

import { healthController, liveController, readyController } from './health.controller';

export const registerHealthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get('/health', {
    schema: {
      summary: 'Estado general',
      description: 'Devuelve un resumen simple del estado general del proceso y MongoDB.',
      tags: ['Salud'],
    },
    handler: healthController,
  });

  app.get('/live', {
    schema: {
      summary: 'Liveness probe',
      description: 'Indica si el proceso HTTP está vivo.',
      tags: ['Salud'],
    },
    handler: liveController,
  });

  app.get('/ready', {
    schema: {
      summary: 'Readiness probe',
      description: 'Indica si la aplicación está lista para recibir tráfico.',
      tags: ['Salud'],
    },
    handler: readyController,
  });
};
