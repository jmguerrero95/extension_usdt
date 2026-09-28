import type { AppConfig } from '../../app/config/env';
import type { ApplicationServices } from '../../app/bootstrap';
import type { AdminSession } from '../../domain/entities/admin-session.entity';
import type { InternalUser } from '../../domain/entities/internal-user.entity';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string | Buffer;
    adminSession?: AdminSession;
    adminUser?: InternalUser;
  }

  interface FastifyInstance {
    config: AppConfig;
    services: ApplicationServices;
  }
}
