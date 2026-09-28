import type { FastifyInstance } from 'fastify';

import { validateRequest } from '../../shared/validation/validate-request';
import {
  panelBeginTwoFactorController,
  panelChangePasswordController,
  panelCloseOtherSessionsController,
  panelConfirmTwoFactorController,
  panelLoginController,
  panelLogoutController,
  panelMeController,
  panelSessionsController,
  panelStepUpController,
  createPanelUserController,
  listPanelUsersController,
  resetPanelUserPasswordController,
  resetPanelUserTwoFactorController,
  updatePanelUserController,
} from './panel-auth.controller';
import {
  changePasswordBodySchema,
  confirmTwoFactorBodySchema,
  createUserBodySchema,
  loginBodySchema,
  resetUserPasswordBodySchema,
  stepUpBodySchema,
  updateUserBodySchema,
  userParamsSchema,
} from './panel-auth.schemas';
import { requirePanelCsrf, requirePanelPermission, requirePanelSession } from './panel-auth.guard';

export const registerPanelAuthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post(
    '/auth/login',
    {
      schema: {
        summary: 'Login del panel interno',
        description: 'Autentica un usuario interno por correo, contraseña y opcionalmente OTP.',
        tags: ['Panel'],
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 60_000,
        },
      },
      preValidation: validateRequest({
        body: loginBodySchema,
      }),
      handler: panelLoginController,
    },
  );

  app.get('/auth/me', {
    schema: {
      summary: 'Perfil autenticado del panel',
      description: 'Devuelve el usuario actual del panel, permisos, CSRF y estado de step-up.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelSession({ allowPendingTwoFactorSetup: true })],
    handler: panelMeController,
  });

  app.post('/auth/logout', {
    schema: {
      summary: 'Cerrar sesión del panel',
      description: 'Revoca la sesión actual del panel interno.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelSession({ allowPendingTwoFactorSetup: true }), requirePanelCsrf],
    handler: panelLogoutController,
  });

  app.post('/auth/step-up', {
    schema: {
      summary: 'Step-up auth del panel',
      description: 'Valida nuevamente contraseña y OTP para acciones sensibles.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelSession(), requirePanelCsrf],
    preValidation: validateRequest({
      body: stepUpBodySchema,
    }),
    handler: panelStepUpController,
  });

  app.post('/auth/2fa/setup', {
    schema: {
      summary: 'Iniciar configuración 2FA',
      description: 'Genera secreto TOTP, URL OTPAuth y QR para el usuario autenticado.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelSession({ allowPendingTwoFactorSetup: true }), requirePanelCsrf],
    handler: panelBeginTwoFactorController,
  });

  app.post('/auth/2fa/confirm', {
    schema: {
      summary: 'Confirmar configuración 2FA',
      description: 'Confirma el secreto TOTP pendiente con un código válido.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelSession({ allowPendingTwoFactorSetup: true }), requirePanelCsrf],
    preValidation: validateRequest({
      body: confirmTwoFactorBodySchema,
    }),
    handler: panelConfirmTwoFactorController,
  });

  app.post('/auth/password/change', {
    schema: {
      summary: 'Cambiar contraseña propia',
      description: 'Actualiza la contraseña del usuario autenticado del panel.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelSession(), requirePanelCsrf],
    preValidation: validateRequest({
      body: changePasswordBodySchema,
    }),
    handler: panelChangePasswordController,
  });

  app.get('/auth/sessions', {
    schema: {
      summary: 'Listar sesiones del usuario actual',
      description: 'Devuelve sesiones activas del usuario interno autenticado.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelSession()],
    handler: panelSessionsController,
  });

  app.post('/auth/sessions/close-others', {
    schema: {
      summary: 'Cerrar otras sesiones',
      description: 'Revoca todas las sesiones del usuario actual excepto la activa.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelSession(), requirePanelCsrf],
    handler: panelCloseOtherSessionsController,
  });

  app.get('/users', {
    schema: {
      summary: 'Listar usuarios internos',
      description: 'Devuelve usuarios internos y su estado de seguridad.',
      tags: ['Panel'],
    },
    preHandler: [requirePanelPermission('users:view')],
    handler: listPanelUsersController,
  });

  app.post('/users', {
    schema: {
      summary: 'Crear usuario interno',
      description: 'Alta de un nuevo usuario interno con rol y contraseña inicial.',
      tags: ['Panel'],
    },
    preHandler: [
      requirePanelPermission('users:manage'),
      requirePanelCsrf,
      async (request) => {
        request.server.services.panelAuthService.assertStepUpFresh(
          request.adminSession as NonNullable<typeof request.adminSession>,
        );
      },
    ],
    preValidation: validateRequest({
      body: createUserBodySchema,
    }),
    handler: createPanelUserController,
  });

  app.patch('/users/:userId', {
    schema: {
      summary: 'Actualizar usuario interno',
      description: 'Permite actualizar nombre visible, rol y estado activo.',
      tags: ['Panel'],
    },
    preHandler: [
      requirePanelPermission('users:manage'),
      requirePanelCsrf,
      async (request) => {
        request.server.services.panelAuthService.assertStepUpFresh(
          request.adminSession as NonNullable<typeof request.adminSession>,
        );
      },
    ],
    preValidation: validateRequest({
      params: userParamsSchema,
      body: updateUserBodySchema,
    }),
    handler: updatePanelUserController,
  });

  app.post('/users/:userId/reset-password', {
    schema: {
      summary: 'Resetear contraseña de usuario',
      description: 'Genera una nueva contraseña para otro usuario e invalida sus sesiones.',
      tags: ['Panel'],
    },
    preHandler: [
      requirePanelPermission('users:manage'),
      requirePanelCsrf,
      async (request) => {
        request.server.services.panelAuthService.assertStepUpFresh(
          request.adminSession as NonNullable<typeof request.adminSession>,
        );
      },
    ],
    preValidation: validateRequest({
      params: userParamsSchema,
      body: resetUserPasswordBodySchema,
    }),
    handler: resetPanelUserPasswordController,
  });

  app.post('/users/:userId/reset-2fa', {
    schema: {
      summary: 'Resetear 2FA de usuario',
      description: 'Elimina la configuración TOTP del usuario objetivo e invalida sus sesiones.',
      tags: ['Panel'],
    },
    preHandler: [
      requirePanelPermission('users:manage'),
      requirePanelCsrf,
      async (request) => {
        request.server.services.panelAuthService.assertStepUpFresh(
          request.adminSession as NonNullable<typeof request.adminSession>,
        );
      },
    ],
    preValidation: validateRequest({
      params: userParamsSchema,
    }),
    handler: resetPanelUserTwoFactorController,
  });
};
