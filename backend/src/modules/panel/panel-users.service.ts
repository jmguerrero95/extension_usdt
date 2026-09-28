import { AppError } from '../../app/errors/app-error';
import type { InternalUser } from '../../domain/entities/internal-user.entity';
import type { AdminSessionRepository } from '../../domain/repositories/admin-session.repository';
import type { InternalUserRepository } from '../../domain/repositories/internal-user.repository';
import type { AdminRole } from '../../shared/constants/admin-auth';
import { isStrongPassword } from '../../shared/utils/password-policy';
import { PasswordService } from '../auth/password.service';
import { PanelAuthService } from './panel-auth.service';

export class PanelUsersService {
  public constructor(
    private readonly userRepository: InternalUserRepository,
    private readonly sessionRepository: AdminSessionRepository,
    private readonly passwordService: PasswordService,
    private readonly panelAuthService: PanelAuthService,
  ) {}

  public async listUsers() {
    const users = await this.userRepository.list();
    return users.map((user) => this.panelAuthService.serializeUser(user));
  }

  public async getUserOrFail(userId: string): Promise<InternalUser> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError({
        code: 'ORDER_NOT_FOUND',
        statusCode: 404,
        message: 'El usuario solicitado no existe.',
      });
    }

    return user;
  }

  public async createUser(input: {
    email: string;
    displayName: string;
    role: AdminRole;
    password: string;
  }) {
    const existing = await this.userRepository.findByEmail(input.email.trim().toLowerCase());
    if (existing) {
      throw new AppError({
        code: 'ORDER_ALREADY_EXISTS',
        statusCode: 409,
        message: 'Ya existe un usuario interno con ese correo.',
      });
    }

    if (!isStrongPassword(input.password)) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        message: 'La contraseña inicial debe tener al menos 12 caracteres.',
      });
    }

    const now = new Date();
    const user = await this.userRepository.create({
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      role: input.role,
      passwordHash: await this.passwordService.hash(input.password),
      active: true,
      twoFactorEnabled: false,
      twoFactorSecretEncrypted: null,
      pendingTwoFactorSecretEncrypted: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      passwordChangedAt: now,
      mustRotatePassword: true,
      createdAt: now,
      updatedAt: now,
    });

    return this.panelAuthService.serializeUser(user);
  }

  public async updateUser(
    userId: string,
    input: {
      displayName?: string;
      role?: AdminRole;
      active?: boolean;
    },
  ) {
    const updatedUser = await this.userRepository.updateById(userId, {
      ...(typeof input.displayName === 'string'
        ? { displayName: input.displayName.trim() }
        : {}),
      ...(input.role ? { role: input.role } : {}),
      ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
    });

    if (!updatedUser) {
      throw new AppError({
        code: 'ORDER_NOT_FOUND',
        statusCode: 404,
        message: 'El usuario solicitado no existe.',
      });
    }

    return this.panelAuthService.serializeUser(updatedUser);
  }

  public async resetPassword(userId: string, newPassword: string) {
    if (!isStrongPassword(newPassword)) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        message: 'La contraseña de reemplazo debe tener al menos 12 caracteres.',
      });
    }

    const updatedUser = await this.userRepository.updateById(userId, {
      passwordHash: await this.passwordService.hash(newPassword),
      passwordChangedAt: new Date(),
      mustRotatePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
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

    await this.sessionRepository.revokeAllByUserId(userId);

    return this.panelAuthService.serializeUser(updatedUser);
  }

  public async resetTwoFactor(userId: string) {
    const updatedUser = await this.userRepository.updateById(userId, {
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

    await this.sessionRepository.revokeAllByUserId(userId);

    return this.panelAuthService.serializeUser(updatedUser);
  }
}
