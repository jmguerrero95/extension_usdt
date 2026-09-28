import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import type { AppConfig } from '../config/env';

export const registerSwagger = async (
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> => {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'GENERAL BYTES CAS Wallet API',
        version: '1.0.0',
        description:
          'API REST backend para flujos BUY y SELL USDT TRC20 por COP, con panel interno seguro de operaciones y administración para futura integración con GENERAL BYTES CAS.',
      },
      servers: [
        {
          url: config.apiBaseUrl,
          description: 'Servidor configurado por API_BASE_URL',
        },
      ],
      tags: [
        { name: 'Salud', description: 'Health checks y probes operativos.' },
        { name: 'CAS', description: 'Endpoints estables para futura extensión GENERAL BYTES CAS.' },
        { name: 'Webhooks', description: 'Recepción de eventos firmados o idempotentes de proveedores.' },
        { name: 'Interno', description: 'Operación interna protegida por X-API-Key.' },
        { name: 'Panel', description: 'APIs internas del panel web de operaciones y administración.' },
      ],
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
    staticCSP: true,
  });
};
