import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { buildSuccessResponse } from '../../shared/utils/api-response';
import { PANEL_SESSION_COOKIE } from '../../shared/constants/panel';
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

const setSessionCookie = (request: FastifyRequest, reply: FastifyReply, token: string) => {
  reply.setCookie(PANEL_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: request.server.config.nodeEnv === 'production',
    maxAge: request.server.config.panel.sessionTtlHours * 60 * 60,
  });
};

const clearSessionCookie = (reply: FastifyReply) => {
  reply.clearCookie(PANEL_SESSION_COOKIE, {
    path: '/',
  });
};

export const panelLoginController = async (request: FastifyRequest, reply: FastifyReply) => {
  const body = request.body as z.infer<typeof loginBodySchema>;
  const result = await request.server.services.panelAuthService.login(body, {
    ipAddress: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  });

  setSessionCookie(request, reply, result.sessionToken);
  reply.send(
    buildSuccessResponse(request.id, {
      user: result.user,
      csrfToken: result.csrfToken,
      requiresTwoFactorSetup: result.session.requiresTwoFactorSetup,
    }),
  );
};

export const panelLogoutController = async (request: FastifyRequest, reply: FastifyReply) => {
  await request.server.services.panelAuthService.logout(request.adminSession?.id as string);
  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'auth',
    action: 'logout',
    actor: request.adminUser ?? null,
    targetType: 'admin_session',
    targetId: request.adminSession?.id ?? null,
  });
  clearSessionCookie(reply);
  reply.send(buildSuccessResponse(request.id, { loggedOut: true }));
};

export const panelMeController = async (request: FastifyRequest, reply: FastifyReply) => {
  reply.send(
    buildSuccessResponse(request.id, {
      user: request.server.services.panelAuthService.serializeUser(request.adminUser as NonNullable<typeof request.adminUser>),
      csrfToken: request.adminSession?.csrfToken ?? null,
      requiresTwoFactorSetup: request.adminSession?.requiresTwoFactorSetup ?? false,
      stepUpValidUntil:
        request.adminSession?.stepUpVerifiedAt
          ? new Date(
              request.adminSession.stepUpVerifiedAt.getTime() +
                request.server.config.panel.stepUpTtlMin * 60_000,
            ).toISOString()
          : null,
    }),
  );
};

export const panelStepUpController = async (request: FastifyRequest, reply: FastifyReply) => {
  const body = request.body as z.infer<typeof stepUpBodySchema>;
  const session = await request.server.services.panelAuthService.requireStepUp(
    request.adminUser as NonNullable<typeof request.adminUser>,
    request.adminSession as NonNullable<typeof request.adminSession>,
    body,
  );

  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'security',
    action: 'step_up_verified',
    actor: request.adminUser ?? null,
    targetType: 'admin_session',
    targetId: request.adminSession?.id ?? null,
  });

  reply.send(
    buildSuccessResponse(request.id, {
      validUntil: new Date(
        session.stepUpVerifiedAt!.getTime() +
          request.server.config.panel.stepUpTtlMin * 60_000,
      ).toISOString(),
    }),
  );
};

export const panelBeginTwoFactorController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  if ((request.adminUser?.twoFactorEnabled ?? false) && !request.adminSession?.requiresTwoFactorSetup) {
    request.server.services.panelAuthService.assertStepUpFresh(
      request.adminSession as NonNullable<typeof request.adminSession>,
    );
  }

  const setup = await request.server.services.panelAuthService.beginTwoFactorSetup(
    request.adminUser as NonNullable<typeof request.adminUser>,
  );

  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'security',
    action: 'two_factor_setup_started',
    actor: request.adminUser ?? null,
    targetType: 'internal_user',
    targetId: request.adminUser?.id ?? null,
  });

  reply.send(buildSuccessResponse(request.id, setup));
};

export const panelConfirmTwoFactorController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const body = request.body as z.infer<typeof confirmTwoFactorBodySchema>;
  const result = await request.server.services.panelAuthService.confirmTwoFactorSetup(
    request.adminUser as NonNullable<typeof request.adminUser>,
    request.adminSession as NonNullable<typeof request.adminSession>,
    body.otpCode,
  );

  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'security',
    action: 'two_factor_setup_confirmed',
    actor: request.adminUser ?? null,
    targetType: 'internal_user',
    targetId: request.adminUser?.id ?? null,
  });

  reply.send(
    buildSuccessResponse(request.id, {
      user: result.user,
      requiresTwoFactorSetup: result.session.requiresTwoFactorSetup,
    }),
  );
};

export const panelChangePasswordController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const body = request.body as z.infer<typeof changePasswordBodySchema>;
  const user = await request.server.services.panelAuthService.changePassword(
    request.adminUser as NonNullable<typeof request.adminUser>,
    request.adminSession?.id as string,
    body,
  );

  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'security',
    action: 'password_changed',
    actor: request.adminUser ?? null,
    targetType: 'internal_user',
    targetId: request.adminUser?.id ?? null,
  });

  reply.send(
    buildSuccessResponse(request.id, {
      user: request.server.services.panelAuthService.serializeUser(user),
    }),
  );
};

export const panelSessionsController = async (request: FastifyRequest, reply: FastifyReply) => {
  const sessions = await request.server.services.panelAuthService.listSessions(
    request.adminUser?.id as string,
  );

  reply.send(
    buildSuccessResponse(
      request.id,
      sessions.map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        current: session.id === request.adminSession?.id,
      })),
    ),
  );
};

export const panelCloseOtherSessionsController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  await request.server.services.panelAuthService.closeOtherSessions(
    request.adminUser?.id as string,
    request.adminSession?.id as string,
  );

  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'security',
    action: 'other_sessions_closed',
    actor: request.adminUser ?? null,
    targetType: 'internal_user',
    targetId: request.adminUser?.id ?? null,
  });

  reply.send(buildSuccessResponse(request.id, { closed: true }));
};

export const listPanelUsersController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const users = await request.server.services.panelUsersService.listUsers();
  reply.send(buildSuccessResponse(request.id, users));
};

export const createPanelUserController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const body = request.body as z.infer<typeof createUserBodySchema>;
  const user = await request.server.services.panelUsersService.createUser(body);
  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'users',
    action: 'user_created',
    actor: request.adminUser ?? null,
    targetType: 'internal_user',
    targetId: user.id,
    metadata: {
      email: user.email,
      role: user.role,
    },
  });
  reply.status(201).send(buildSuccessResponse(request.id, user));
};

export const updatePanelUserController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { userId } = request.params as z.infer<typeof userParamsSchema>;
  const body = request.body as z.infer<typeof updateUserBodySchema>;
  const user = await request.server.services.panelUsersService.updateUser(userId, body);
  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'users',
    action: 'user_updated',
    actor: request.adminUser ?? null,
    targetType: 'internal_user',
    targetId: user.id,
    metadata: body,
  });
  reply.send(buildSuccessResponse(request.id, user));
};

export const resetPanelUserPasswordController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { userId } = request.params as z.infer<typeof userParamsSchema>;
  const body = request.body as z.infer<typeof resetUserPasswordBodySchema>;
  const user = await request.server.services.panelUsersService.resetPassword(
    userId,
    body.newPassword,
  );
  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'users',
    action: 'user_password_reset',
    actor: request.adminUser ?? null,
    targetType: 'internal_user',
    targetId: user.id,
  });
  reply.send(buildSuccessResponse(request.id, user));
};

export const resetPanelUserTwoFactorController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { userId } = request.params as z.infer<typeof userParamsSchema>;
  const user = await request.server.services.panelUsersService.resetTwoFactor(userId);
  await request.server.services.adminAuditService.logRequest({
    request,
    category: 'users',
    action: 'user_two_factor_reset',
    actor: request.adminUser ?? null,
    targetType: 'internal_user',
    targetId: user.id,
  });
  reply.send(buildSuccessResponse(request.id, user));
};
