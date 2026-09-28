import pino from 'pino';

import type { AppConfig } from '../../app/config/env';

export const createLogger = (config: AppConfig) =>
  pino({
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.x-api-key',
        'headers.x-api-key',
        'apiKey',
        'api_key',
        'signature',
        'secret',
        'privateKey',
        'private_key',
      ],
      censor: '[REDACTED]',
    },
    transport:
      config.nodeEnv === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
            },
          }
        : undefined,
  });
