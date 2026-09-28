import type { FastifyReply, FastifyRequest } from 'fastify';

import { isDatabaseReady } from '../../infrastructure/db/connection';

export const healthController = async (_request: FastifyRequest, reply: FastifyReply) => {
  reply.send({
    status: 'ok',
    uptimeSec: process.uptime(),
    database: isDatabaseReady() ? 'up' : 'down',
  });
};

export const liveController = async (_request: FastifyRequest, reply: FastifyReply) => {
  reply.send({
    status: 'alive',
  });
};

export const readyController = async (_request: FastifyRequest, reply: FastifyReply) => {
  if (!isDatabaseReady()) {
    reply.status(503).send({
      status: 'degraded',
      database: 'down',
    });
    return;
  }

  reply.send({
    status: 'ready',
    database: 'up',
  });
};
