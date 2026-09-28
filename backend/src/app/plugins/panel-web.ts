import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';

export const registerPanelWebPlugins = async (app: FastifyInstance): Promise<void> => {
  await app.register(cookie);

  await app.register(fastifyStatic, {
    root: path.resolve(process.cwd(), 'panel'),
    prefix: '/panel/assets/',
    decorateReply: true,
    wildcard: false,
  });
};
