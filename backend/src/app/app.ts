import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';

import type { AppConfig } from './config/env';
import type { ApplicationServices } from './bootstrap';
import { requestContextHook } from './middleware/request-context';
import { registerRawBodyPlugin } from './plugins/raw-body';
import { registerSecurityPlugins } from './plugins/security';
import { registerPanelWebPlugins } from './plugins/panel-web';
import { registerSwagger } from './plugins/swagger';
import { registerErrorHandler } from './errors/error-handler';
import { registerRoutes } from './routes';
import { parseByteSize } from '../shared/utils/bytes';

export const createApp = async (params: {
  config: AppConfig;
  logger: FastifyBaseLogger;
  services: ApplicationServices;
}) => {
  const app = Fastify({
    loggerInstance: params.logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: true,
    bodyLimit: parseByteSize(params.config.security.webhookRawBodyLimit),
  });

  app.decorate('config', params.config);
  app.decorate('services', params.services);

  app.addHook('onRequest', requestContextHook);

  await registerRawBodyPlugin(app, params.config);
  await registerSecurityPlugins(app, params.config);
  await registerPanelWebPlugins(app);
  await registerSwagger(app, params.config);

  registerErrorHandler(app);
  await registerRoutes(app);

  return app;
};
