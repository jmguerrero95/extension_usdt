import { AppError } from '../../app/errors/app-error';
import type { AppConfig } from '../../app/config/env';
import type { AdminSession } from '../../domain/entities/admin-session.entity';
import type { InternalUser } from '../../domain/entities/internal-user.entity';
import type { AdminSessionRepository } from '../../domain/repositories/admin-session.repository';
import type { InternalUserRepository } from '../../domain/repositories/internal-user.repository';
import { decryptText, encryptText } from '../../infrastructure/crypto/encryption';
import { PasswordService } from '../auth/password.service';
import { TotpService } from '../auth/totp.service';
import { AdminAuditService } from './admin-audit.service';
import { PERMISSIONS_BY_ROLE } from '../../shared/constants/admin-auth';
import { randomToken, sha256Hex } from '../../shared/utils/security';
import { isStrongPassword } from '../../shared/utils/password-policy';

interface RequestSecurityContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface LoginInput {
  email: string;
  password: string;
  otpCode?: string;
}

interface StepUpInput {
  password: string;
  otpCode: string;
}

interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}

export class PanelAuthService {
  public constructor(
    private readonly config: AppConfig,
    private readonly userRepository: InternalUserRepository,
    private readonly sessionRepository: AdminSessionRepository,
    private readonly passwordService: PasswordService,
    private readonly totpService: TotpService,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  public async bootstrapAdminIfNeeded(): Promise<void> {
    const existingUsers = await this.userRepository.count();
    if (existingUsers > 0 || !this.config.panel.bootstrapAdmin.email || !this.config.panel.bootstrapAdmin.password) {
      return;
    }

    const now = new Date();
    const passwordHash = await this.passwordService.hash(this.config.panel.bootstrapAdmin.password);

    await this.userRepository.create({
      email: this.config.panel.bootstrapAdmin.email.toLowerCase(),
      displayName: this.config.panel.bootstrapAdmin.name,
      role: 'admin',
      passwordHash,
      active: true,
      twoFactorEnabled: false,
      twoFactorSecretEncrypted: null,
      pendingTwoFactorSecretEncrypted: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      passwordChangedAt: now,
      mustRotatePassword: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  public async login(input: LoginInput, context: RequestSecurityContext) {
    const email = input.email.trim().toLowerCase();
    const user = await this.userRepository.findByEmail(email);
    const genericMessage = 'Las credenciales enviadas no son válidas.';

    if (!user || !user.active) {
      await this.adminAuditService.log({
        category: 'auth',
        action: 'login_failed',
        actorUserId: null,
        actorEmail: email,
        actorRole: null,
        targetType: 'internal_user',
        targetId: null,
        orderId: null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          reason: 'user-not-found-or-inactive',
        },
      });

      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: genericMessage,
      });
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError({
        code: 'FORBIDDEN',
        statusCode: 403,
        message: 'La cuenta se encuentra bloqueada temporalmente por intentos fallidos repetidos.',
      });
    }

    const passwordValid = await this.passwordService.verify(user.passwordHash, input.password);
    const currentSecret = this.readEncryptedSecret(user.twoFactorSecretEncrypted);
    const otpValid =
      !user.twoFactorEnabled ||
      (typeof input.otpCode === 'string' &&
        typeof currentSecret === 'string' &&
        this.totpService.verify(currentSecret, input.otpCode));

    if (!passwordValid || !otpValid) {
      const failedAttempts = user.failedLoginAttempts + 1;
      const lockedUntil =
        failedAttempts >= this.config.panel.loginMaxAttempts
          ? new Date(Date.now() + this.config.panel.lockoutMinutes * 60_000)
          : null;

      await this.userRepository.updateById(user.id as string, {
        failedLoginAttempts: lockedUntil ? 0 : failedAttempts,
        lockedUntil,
      });

      await this.adminAuditService.log({
        category: 'auth',
        action: 'login_failed',
        actorUserId: user.id as string,
        actorEmail: user.email,
        actorRole: user.role,
        targetType: 'internal_user',
        targetId: user.id as string,
        orderId: null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          reason: passwordValid ? 'invalid-otp' : 'invalid-password',
          lockedUntil: lockedUntil?.toISOString() ?? null,
        },
      });

      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: genericMessage,
      });
    }

    const now = new Date();
    const sessionToken = randomToken(32);
    const csrfToken = randomToken(24);
    const session = await this.sessionRepository.create({
      sessionTokenHash: sha256Hex(sessionToken),
      userId: user.id as string,
      csrfToken,
      requiresTwoFactorSetup: !user.twoFactorEnabled,
      stepUpVerifiedAt: !user.twoFactorEnabled ? now : null,
      expiresAt: new Date(now.getTime() + this.config.panel.sessionTtlHours * 60 * 60 * 1_000),
      lastSeenAt: now,
      revokedAt: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      createdAt: now,
      updatedAt: now,
    });

    const updatedUser = await this.userRepository.updateById(user.id as string, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: now,
    });

    await this.adminAuditService.log({
      category: 'auth',
      action: 'login_success',
      actorUserId: user.id as string,
      actorEmail: user.email,
      actorRole: user.role,
      targetType: 'admin_session',
      targetId: session.id as string,
      orderId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        requiresTwoFactorSetup: !user.twoFactorEnabled,
      },
    });

    return {
      sessionToken,
      csrfToken,
      session,
      user: this.serializeUser(updatedUser ?? user),
    };
  }

  public async resolveSession(sessionToken: string): Promise<{
    session: AdminSession;
    user: InternalUser;
  } | null> {
    const session = await this.sessionRepository.findByTokenHash(sha256Hex(sessionToken));
    if (!session) {
      return null;
    }

    const user = await this.userRepository.findById(session.userId);
    if (!user || !user.active) {
      return null;
    }

    if (session.lastSeenAt.getTime() < Date.now() - 60_000) {
      await this.sessionRepository.updateById(session.id as string, {
        lastSeenAt: new Date(),
      });
    }

    return { session, user };
  }

  public async logout(sessionId: string): Promise<void> {
    await this.sessionRepository.updateById(sessionId, {
      revokedAt: new Date(),
    });
  }

  public async requireStepUp(
    user: InternalUser,
    session: AdminSession,
    input: StepUpInput,
  ): Promise<AdminSession> {
    const passwordValid = await this.passwordService.verify(user.passwordHash, input.password);
    const currentSecret = this.readEncryptedSecret(user.twoFactorSecretEncrypted);
    const otpValid =
      user.twoFactorEnabled &&
      typeof currentSecret === 'string' &&
      this.totpService.verify(currentSecret, input.otpCode);

    if (!passwordValid || !otpValid) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'La reautenticación fuerte no es válida.',
      });
    }

    const updatedSession = await this.sessionRepository.updateById(session.id as string, {
      stepUpVerifiedAt: new Date(),
    });

    if (!updatedSession) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'La sesión ya no es válida.',
      });
    }

    return updatedSession;
  }

  public assertStepUpFresh(session: AdminSession): void {
    if (
      !session.stepUpVerifiedAt ||
      session.stepUpVerifiedAt.getTime() <
        Date.now() - this.config.panel.stepUpTtlMin * 60_000
    ) {
      throw new AppError({
        code: 'FORBIDDEN',
        statusCode: 403,
        message: 'La acción requiere reautenticación fuerte reciente.',
      });
    }
  }

  public async beginTwoFactorSetup(user: InternalUser) {
    const secret = this.totpService.generateSecret();
    const encryptedSecret = encryptText(this.config.panel.encryptionSecret, secret);
    const updatedUser = await this.userRepository.updateById(user.id as string, {
      pendingTwoFactorSecretEncrypted: encryptedSecret,
    });

    if (!updatedUser) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'El usuario ya no se encuentra disponible.',
      });
    }

    return {
      secret,
      otpAuthUrl: this.totpService.buildOtpAuthUrl(updatedUser.email, secret),
      qrDataUrl: await this.totpService.buildQrDataUrl(updatedUser.email, secret),
    };
  }

  public async confirmTwoFactorSetup(user: InternalUser, session: AdminSession, otpCode: string) {
    const pendingSecret = this.readEncryptedSecret(user.pendingTwoFactorSecretEncrypted);
    if (!pendingSecret || !this.totpService.verify(pendingSecret, otpCode)) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'El código 2FA no coincide con la configuración pendiente.',
      });
    }

    const encryptedSecret = encryptText(this.config.panel.encryptionSecret, pendingSecret);
    const updatedUser = await this.userRepository.updateById(user.id as string, {
      twoFactorEnabled: true,
      twoFactorSecretEncrypted: encryptedSecret,
      pendingTwoFactorSecretEncrypted: null,
    });

    const updatedSession = await this.sessionRepository.updateById(session.id as string, {
      requiresTwoFactorSetup: false,
      stepUpVerifiedAt: new Date(),
    });

    if (!updatedUser || !updatedSession) {
      throw new AppError({
        code: 'INTERNAL_ERROR',
        statusCode: 500,
        message: 'No fue posible confirmar la configuración 2FA.',
      });
    }

    return {
      user: this.serializeUser(updatedUser),
      session: updatedSession,
    };
  }

  public async resetTwoFactorForSelf(user: InternalUser): Promise<InternalUser> {
    const updatedUser = await this.userRepository.updateById(user.id as string, {
      twoFactorEnabled: false,
      twoFactorSecretEncrypted: null,
      pendingTwoFactorSecretEncrypted: null,
    });

    if (!updatedUser) {
      throw new AppError({
        code: 'ORDER_NOT_FOUND',
        statusCode: 404,
        message: 'El usuario solicitado no existe.',
      });
    }

    return updatedUser;
  }

  public async changePassword(
    user: InternalUser,
    currentSessionId: string,
    input: ChangePasswordInput,
  ): Promise<InternalUser> {
    const passwordValid = await this.passwordService.verify(user.passwordHash, input.currentPassword);
    if (!passwordValid) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'La contraseña actual no es válida.',
      });
    }

    if (!isStrongPassword(input.newPassword)) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        message: 'La nueva contraseña debe tener al menos 12 caracteres.',
      });
    }

    const updatedUser = await this.userRepository.updateById(user.id as string, {
      passwordHash: await this.passwordService.hash(input.newPassword),
      passwordChangedAt: new Date(),
      mustRotatePassword: false,
    });

    if (!updatedUser) {
      throw new AppError({
        code: 'INTERNAL_ERROR',
        statusCode: 500,
        message: 'No fue posible actualizar la contraseña.',
      });
    }

    if (input.revokeOtherSessions ?? true) {
      await this.sessionRepository.revokeOtherSessions(user.id as string, currentSessionId);
    }

    return updatedUser;
  }

  public async listSessions(userId: string): Promise<AdminSession[]> {
    return this.sessionRepository.listActiveByUserId(userId);
  }

  public async closeOtherSessions(userId: string, currentSessionId: string): Promise<void> {
    await this.sessionRepository.revokeOtherSessions(userId, currentSessionId);
  }

  public serializeUser(user: InternalUser) {
    return {
      id: user.id as string,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      twoFactorEnabled: user.twoFactorEnabled,
      requiresTwoFactorSetup: !user.twoFactorEnabled,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
      mustRotatePassword: user.mustRotatePassword,
      permissions: PERMISSIONS_BY_ROLE[user.role],
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private readEncryptedSecret(value: string | null): string | null {
    if (!value) {
      return null;
    }

    return decryptText(this.config.panel.encryptionSecret, value);
  }
}
