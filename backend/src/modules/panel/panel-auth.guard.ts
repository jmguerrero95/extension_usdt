import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../../app/errors/app-error';
import type { AdminPermission } from '../../shared/constants/admin-auth';
import { roleHasPermission } from '../../shared/constants/admin-auth';
import { PANEL_CSRF_HEADER, PANEL_SESSION_COOKIE } from '../../shared/constants/panel';
import { safeEqual } from '../../shared/utils/security';

export const requirePanelSession =
  (options?: { allowPendingTwoFactorSetup?: boolean }) =>
  async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const sessionToken = request.cookies[PANEL_SESSION_COOKIE];
    if (typeof sessionToken !== 'string' || sessionToken.trim() === '') {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'La sesión del panel no es válida o no existe.',
      });
    }

    const resolved = await request.server.services.panelAuthService.resolveSession(sessionToken);
    if (!resolved) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'La sesión del panel no es válida o expiró.',
      });
    }

    if (resolved.session.requiresTwoFactorSetup && !options?.allowPendingTwoFactorSetup) {
      throw new AppError({
        code: 'FORBIDDEN',
        statusCode: 403,
        message:
          'Debes completar la configuración obligatoria de 2FA antes de usar el panel.',
      });
    }

    request.adminSession = resolved.session;
    request.adminUser = resolved.user;
  };

export const requirePanelPermission =
  (permission: AdminPermission, options?: { allowPendingTwoFactorSetup?: boolean }) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requirePanelSession(options)(request, reply);

    if (!request.adminUser || !roleHasPermission(request.adminUser.role, permission)) {
      throw new AppError({
        code: 'FORBIDDEN',
        statusCode: 403,
        message: 'No cuentas con permisos suficientes para esta acción.',
      });
    }
  };

export const requirePanelCsrf = async (
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> => {
  if (!request.adminSession) {
    throw new AppError({
      code: 'UNAUTHORIZED',
      statusCode: 401,
      message: 'La sesión del panel no es válida o expiró.',
    });
  }

  const csrfHeader = request.headers[PANEL_CSRF_HEADER];
  if (
    typeof csrfHeader !== 'string' ||
    !safeEqual(csrfHeader, request.adminSession.csrfToken)
  ) {
    throw new AppError({
      code: 'FORBIDDEN',
      statusCode: 403,
      message: 'El token CSRF no es válido para esta operación.',
    });
  }
};
